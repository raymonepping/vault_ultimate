#!/bin/bash
# compose/identity/keycloak/setup_keycloak.sh: idempotent realm, federation and
# clients for vault_ultimate (from vault_dance).
#
#   realm    tidewell
#   LDAP     read-only federation, bind cn=keycloak-bind (its password is the
#            before estate's standing secret; act 4 hands it to Vault)
#   groups   platform, bookings -> the `groups` claim
#   clients  tidewell-console  public, code + PKCE (Saskia's console; no secret)
#            tidewell-booking  confidential, code + PKCE (the booking app; its
#                              client secret is an inventory item, D4)
#            tidewell-cli      public, direct access grants: LOCAL LAB ONLY, for
#                              the rehearsal's scripted sign-ins
#   claims   groups, aud += tidewell-vault (Vault's jwt role binds it)
#
# The bind password is set at creation only: after act 4 Vault rotates it and
# pushes it here itself (ansible act-4); a rerun must not put the old one back.
# VULT_SET_KEYCLOAK_BIND=1 (stage-reset) restores the before estate on purpose.
# Nothing secret is printed.
set -euo pipefail

KC=/opt/keycloak/bin/kcadm.sh
KC_URL="${KC_INTERNAL_URL:-http://keycloak:8080}"
REALM=tidewell
AUDIENCE=tidewell-vault
LDAP_BASE_DN="dc=tidewell,dc=lab"
SECRETS=/run/secrets

"$KC" config credentials --server "$KC_URL" --realm master --user admin \
  --password "$(cat "$SECRETS/keycloak-admin-password")" >/dev/null 2>&1 || {
  for _ in $(seq 1 40); do
    sleep 3
    "$KC" config credentials --server "$KC_URL" --realm master --user admin \
      --password "$(cat "$SECRETS/keycloak-admin-password")" >/dev/null 2>&1 && break
  done
}

first_id() { grep -m1 '"id" *:' | sed -E 's/.*"id" *: *"([^"]*)".*/\1/'; return 0; }
component_id() { "$KC" get components -r "$REALM" -q "name=$1" --fields id 2>/dev/null | first_id; }
client_uuid() { "$KC" get clients -r "$REALM" -q clientId="$1" --fields id 2>/dev/null | first_id; }
mapper_exists() { "$KC" get "clients/$1/protocol-mappers/models" -r "$REALM" 2>/dev/null | grep -q "\"name\" *: *\"$2\""; }

if "$KC" get "realms/$REALM" >/dev/null 2>&1; then echo "  = realm $REALM"; else
  "$KC" create realms -s realm="$REALM" -s enabled=true -s sslRequired=EXTERNAL \
    -s accessTokenLifespan=300 -s ssoSessionIdleTimeout=3600 -s ssoSessionMaxLifespan=36000
  echo "  + realm $REALM"
fi

id=$(component_id tidewell-ldap)
if [ -n "$id" ]; then
  echo "  = LDAP federation"
  if [ "${VULT_SET_KEYCLOAK_BIND:-0}" = 1 ]; then
    "$KC" update "components/$id" -r "$REALM" -s "config.bindCredential=[\"$(cat "$SECRETS/system/keycloak-bind")\"]" >/dev/null
    echo "  * bind credential reset to the before estate's (stage-reset)"
  fi
else
  id=$("$KC" create components -r "$REALM" -i \
    -s name=tidewell-ldap -s providerId=ldap -s providerType=org.keycloak.storage.UserStorageProvider \
    -s 'config.enabled=["true"]' -s 'config.vendor=["other"]' \
    -s 'config.usernameLDAPAttribute=["uid"]' -s 'config.rdnLDAPAttribute=["uid"]' \
    -s 'config.uuidLDAPAttribute=["entryUUID"]' \
    -s 'config.userObjectClasses=["inetOrgPerson, organizationalPerson"]' \
    -s 'config.connectionUrl=["ldap://openldap:389"]' \
    -s "config.usersDn=[\"ou=people,${LDAP_BASE_DN}\"]" \
    -s "config.bindDn=[\"cn=keycloak-bind,ou=system,${LDAP_BASE_DN}\"]" \
    -s "config.bindCredential=[\"$(cat "$SECRETS/system/keycloak-bind")\"]" \
    -s 'config.editMode=["READ_ONLY"]' -s 'config.syncRegistrations=["false"]' \
    -s 'config.pagination=["true"]' -s 'config.importEnabled=["true"]' -s 'config.trustEmail=["true"]')
  echo "  + LDAP federation"
fi
if [ -z "$(component_id tidewell-groups)" ]; then
  "$KC" create components -r "$REALM" -s name=tidewell-groups -s providerId=group-ldap-mapper \
    -s providerType=org.keycloak.storage.ldap.mappers.LDAPStorageMapper -s parentId="$id" \
    -s "config.\"groups.dn\"=[\"ou=groups,${LDAP_BASE_DN}\"]" \
    -s 'config."group.name.ldap.attribute"=["cn"]' -s 'config."group.object.classes"=["groupOfNames"]' \
    -s 'config."membership.ldap.attribute"=["member"]' -s 'config."membership.attribute.type"=["DN"]' \
    -s 'config.mode=["READ_ONLY"]' -s 'config."preserve.group.inheritance"=["false"]' \
    -s 'config."ignore.missing.groups"=["false"]' >/dev/null
  echo "  + group mapper"
fi
fn=$("$KC" get components -r "$REALM" -q parent="$id" -q name="first name" --fields id 2>/dev/null | first_id)
[ -z "$fn" ] || "$KC" update "components/$fn" -r "$REALM" -s 'config."ldap.attribute"=["givenName"]' >/dev/null
"$KC" create "user-storage/${id}/sync?action=triggerFullSync" -r "$REALM" -s x=1 >/dev/null 2>&1 || true

ensure_client() { # clientId public(true|false) redirect directGrants(true|false)
  local uuid
  uuid=$(client_uuid "$1")
  if [ -z "$uuid" ]; then
    "$KC" create clients -r "$REALM" -s clientId="$1" -s protocol=openid-connect \
      -s publicClient="$2" -s standardFlowEnabled="$([ -n "$3" ] && echo true || echo false)" \
      -s implicitFlowEnabled=false -s directAccessGrantsEnabled="$4" -s serviceAccountsEnabled=false \
      -s 'attributes."pkce.code.challenge.method"=S256' \
      -s "redirectUris=[$([ -n "$3" ] && printf '"%s"' "$3")]" -s webOrigins='[]' >/dev/null
    uuid=$(client_uuid "$1")
    echo "  + client $1" >&2
    touch "/tmp/new-client-$1"
  fi
  echo "$uuid"
}
CONSOLE=$(ensure_client tidewell-console true "${VULT_CONSOLE_URL}/auth/callback" false)
BOOKING=$(ensure_client tidewell-booking false "${VULT_BOOKING_URL}/auth/callback" false)
CLI=$(ensure_client tidewell-cli true "" true)
# The booking client's secret: the before estate's, set when the client is
# created and on a stage reset only (act 4 may replace client authentication,
# probe question 7; a rerun must not undo it).
if [ -f /tmp/new-client-tidewell-booking ] || [ "${VULT_SET_BOOKING_SECRET:-0}" = 1 ]; then
  "$KC" update "clients/$BOOKING" -r "$REALM" -s clientAuthenticatorType=client-secret \
    -s "secret=$(cat "$SECRETS/booking-client-secret")" >/dev/null
  echo "  * booking client secret set from .secrets/identity (never printed)"
fi

for uuid in "$CONSOLE" "$BOOKING" "$CLI"; do
  mapper_exists "$uuid" groups || "$KC" create "clients/$uuid/protocol-mappers/models" -r "$REALM" \
    -s name=groups -s protocol=openid-connect -s protocolMapper=oidc-group-membership-mapper \
    -s 'config."full.path"=false' -s 'config."id.token.claim"=true' \
    -s 'config."access.token.claim"=true' -s 'config."userinfo.token.claim"=true' -s 'config."claim.name"=groups' >/dev/null
  mapper_exists "$uuid" vault-audience || "$KC" create "clients/$uuid/protocol-mappers/models" -r "$REALM" \
    -s name=vault-audience -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper \
    -s "config.\"included.custom.audience\"=$AUDIENCE" \
    -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=true' >/dev/null
done
echo "Keycloak realm $REALM ready: clients tidewell-console, tidewell-booking, tidewell-cli (lab only)"
