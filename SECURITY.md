# Security Policy

## Supported versions

VelarScript has no stable production release yet. The current development line
receives security fixes, but its internal 1.0 acceptance is not a production
support claim.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** flow to open a
private GitHub security advisory. Do not disclose an exploitable compiler,
development-server, package-boundary, generated-output, browser-runtime, or
deployment-verification issue in a public issue before it is contained.

Include the affected commit or package version, operating system and Node.js
version, the smallest reproduction available, expected and observed behavior,
and the security impact. Avoid placing real credentials, private source, or
personal data in the report.

After confirmation, the fix should add a focused regression test at the owning
boundary. Publication timing and disclosure are coordinated through the
private advisory rather than inferred from ordinary release automation.
