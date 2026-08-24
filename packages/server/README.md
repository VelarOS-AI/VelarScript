# @velarscript/server

The official convention-based VelarScript server application framework. It is
activated explicitly in `velar.json`, composes `@velarscript/node`, and owns
root `application.yml` loading,
application startup assembly, and typed application-scoped connection
lifecycle.

`authenticate(credential, verify)` turns one checked `security` descriptor into
a request-scoped `Provider<Identity>`. The verifier must resolve to a typed
optional identity: `null` rejects the credential with the descriptor's opaque
401 challenge, while a value is cached for the request and may be injected with
`input.dependency`. Verification failures that are not credential rejection
remain server failures rather than being mislabeled as 401 responses.

The framework owns this composition boundary, not an identity model. JWT/JWK,
OIDC, password hashing, signed sessions, and provider integrations remain
installed libraries. User records, tenants, roles, permissions, revocation, and
session persistence remain application policy.

Concrete database drivers, models, migrations, and queries remain ordinary
application dependencies.
