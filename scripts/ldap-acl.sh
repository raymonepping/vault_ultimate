#!/usr/bin/env bash
# scripts/ldap-acl.sh: the directory's access rules, applied over ldapi://
# inside vult-openldap (SASL EXTERNAL as the container's root: the only way to
# change cn=config). The whole olcAccess list is replaced in a known order, so
# a run is idempotent. vault-rotator may write exactly one password:
# keycloak-bind's (act 4), and the probe's scratch cn=probe-bind. People change
# only their own.
set -euo pipefail
B="dc=tidewell,dc=lab"
podman exec -i vult-openldap ldapmodify -Q -Y EXTERNAL -H ldapi:/// >/dev/null <<LDIF
dn: olcDatabase={1}mdb,cn=config
changetype: modify
replace: olcAccess
olcAccess: {0}to * by dn.exact=gidNumber=0+uidNumber=0,cn=peercred,cn=external,cn=auth manage by * break
olcAccess: {1}to dn.regex="^cn=(keycloak-bind|probe-bind),ou=system,$B$" attrs=userPassword by dn.exact="cn=admin,$B" write by dn.exact="cn=vault-rotator,ou=system,$B" write by anonymous auth by * none
olcAccess: {2}to attrs=userPassword,shadowLastChange by self write by dn.exact="cn=admin,$B" write by anonymous auth by * none
olcAccess: {3}to * by dn.exact="cn=admin,$B" write by dn.exact="cn=keycloak-bind,ou=system,$B" read by dn.exact="cn=vault-rotator,ou=system,$B" read by users read by * none
LDIF
echo "ldap-acl: access rules applied (vault-rotator writes keycloak-bind's and probe-bind's passwords only)"
