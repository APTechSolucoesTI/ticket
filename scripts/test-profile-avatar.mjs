import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarFileError, avatarImageExtension, isOwnAvatarPath, MAX_AVATAR_BYTES } from "../apps/web/src/lib/profile-avatar.ts";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrAAAAABJRU5ErkJggg==", "base64");
test("photo limits reject empty, oversized and unsupported files", () => {
  assert.match(avatarFileError(0, "image/png"), /vazia/);
  assert.match(avatarFileError(MAX_AVATAR_BYTES + 1, "image/png"), /2 MB/);
  assert.match(avatarFileError(10, "image/svg+xml"), /JPG, PNG ou WebP/);
  assert.equal(avatarFileError(MAX_AVATAR_BYTES, "image/jpeg"), null);
});
test("content signature is validated separately from MIME", () => {
  assert.equal(avatarImageExtension(png, "image/png"), "png");
  assert.throws(() => avatarImageExtension(png, "image/jpeg"), /conteúdo/);
  assert.throws(() => avatarImageExtension(Buffer.from("<svg>not an image</svg>"), "image/png"), /conteúdo/);
});
test("stored photo paths must belong to the authenticated tenant and user", () => {
  const path = "tenant/user/ca100000-0000-4000-8000-000000000001.png";
  assert.equal(isOwnAvatarPath(path, "tenant", "user"), true);
  for (const value of [null, "other/user/file.png", "tenant/other/file.png", "tenant/user/../file.png", `${path}/extra`, "https://example.test/photo.png"])
    assert.equal(isOwnAvatarPath(value, "tenant", "user"), false);
});
