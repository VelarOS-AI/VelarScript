# @velarscript/server

The official convention-based VelarScript server application framework. It is
activated explicitly in `velar.json`, composes `@velarscript/node`, and owns
root `application.yml` loading,
application startup assembly, and typed application-scoped connection
lifecycle.

Concrete database drivers, models, migrations, and queries remain ordinary
application dependencies.
