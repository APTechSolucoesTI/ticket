# Scanned upload rollout

The operator approved preserving WhatsApp voice recordings, audio and video on
22 October. The worker validates their actual containers, extensions and MIME,
including OGG/Opus and audio WebM, with the same 25 MiB limit and antivirus.
The ClamAV daemon is deployed and tested with synthetic data.

Apply only after the exact application commit passes all five CI jobs:

Temporarily disable application autoDeploy before merging this batch. Publish
API before web manually through Dokploy, then restore autoDeploy after validation.

1. Confirm `apticket-antivirus:3310` is healthy from the API network and test a
   clean synthetic buffer and EICAR directly, without writing either to Storage.
2. Apply and register `20261022162436_scanned_upload_boundary.sql` transactionally.
   This adds authorization/receipt RPCs without closing existing producers.
3. Publish the API through GitHub → Dokploy. Confirm its worker asset is present,
   endpoint authentication works and a synthetic permitted file can be stored
   and deleted. Never use customer attachments or send real email/WhatsApp messages.
4. Publish the web application through the same pipeline. Update the self-hosted
   Edge function `client-documents-upload` together with its handler and shared
   bounded-body helper. Configure operator-owned `APTICKET_API_URL` to the existing
   trusted API, e.g. the public application origin followed by `/backend`.
   Refresh its runtime; the cached old worker would fail the final receipt guard.
5. Confirm every producer uses the scanner and is compatible with approved MIME
   types. Then apply/register `20261022163913_enforce_scanned_storage_writes.sql`.
   This closes browser Storage writes and requires a short-lived receipt even
   for service-role writes to the eight APTicket buckets. Other apps' buckets
   are excluded. Storage API 1.60.4 performs a rolled-back permission probe;
   the receipt must survive that probe and be consumed only by the final write.
6. Verify a synthetic clean file succeeds, raw authenticated/service-role writes
   without a receipt fail, and the temporary object is deleted. Confirm read,
   delete, profile avatar, financial documents, email and WhatsApp flows.

On scanner outage, uploads return 503. Do not disable scanning or mint receipts
without a clean verdict. Email retains unread messages for retry; WhatsApp releases
its temporary reservation before retrying scanner outages. Temporary files from
an unfinished batch are removed before retrying. No external URL fallback can
publish unscanned media.

Rollback order: remove the final Storage guard/policies using its dedicated
rollback, revert/redeploy the consumers, then remove the first-stage RPC contract
if no consumers remain. Never remove receipt RPCs while their guard is active.
Use normal Git commits and migrations; preserve published history and backups.
