# Attachment scanner

Auxiliary Compose service in the existing APTicket Dokploy project. Source is
GitHub and the Compose path is `./infra/antivirus/compose.yml`. No public domain
or published TCP port is required. The API reaches `apticket-antivirus:3310`
through the internal Docker network; tenants cannot configure this destination.

The official ClamAV image is pinned by digest. Signatures persist in a dedicated
volume and FreshClam updates them. Files arrive over INSTREAM and are never
mounted from application storage. Limits cover scan time, archive expansion,
recursion and encrypted archives/documents. Exceeded limits reject the file.

Memory is capped at 4 GiB. Concurrent database reload is disabled to reduce
memory peaks; uploads may temporarily return 503 during a reload. The API also
rejects uploads when the scanner cannot return a clean result. Keep the TCP
socket private: ClamD does not authenticate its protocol.

Reference: [official Docker guidance](https://docs.clamav.net/manual/Installing/Docker.html)
and [scanner/network configuration](https://docs.clamav.net/manual/Usage/Scanning.html).
