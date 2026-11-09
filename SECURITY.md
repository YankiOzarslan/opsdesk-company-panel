# Security

This repository intentionally excludes runtime records, private configuration, backups and encryption keys. It starts with an empty database; fixture credentials in tests are synthetic.

- Do not commit `.env`, databases, exports, logs, tokens or `.secrets/`.
- Operate behind HTTPS with strong, independently generated secrets.
- Keep the encryption key outside Git and back it up separately from the database.
- Public lookup features send the requested hostname/IP to external services; disable automatic checks if that is unsuitable for your environment.
- Do not report credentials, personal information or production dumps in public issues. Use GitHub's private vulnerability reporting if enabled; otherwise contact the repository owner privately before sharing reproduction data.

`npm run check:share` is a guardrail, not a substitute for reviewing content before publication.
