/**
 * The dock's file panel decides between an editor and a media element from the extension alone.
 * That decision is pure, so it is tested without opening a window — at the edges that actually bite:
 * a name with no extension, a dot inside a directory name, and a mixed-case extension.
 */
const test = require("node:test");
const assert = require("node:assert");
const { extensionOf, mediaMimeFor, previewKindFor } = require("../dist/main/file-kind.js");

test("image and audio extensions get a media preview", () => {
  for (const name of ["logo.png", "photo.JPEG", "icon.svg", "shot.webp", "art.avif"])
    assert.equal(previewKindFor(name), "image", name);
  for (const name of ["tone.wav", "song.MP3", "voice.m4a", "take.flac"])
    assert.equal(previewKindFor(name), "audio", name);
});

test("everything else stays in the editor", () => {
  for (const name of ["app.ts", "README.md", "Makefile", "data.json", "notes.txt", "noext"])
    assert.equal(previewKindFor(name), "text", name);
});

test("a renamed media file is not media", () => {
  // The extension decides, so a backup of a PNG is text — the panel should not try to decode it.
  assert.equal(previewKindFor("logo.png.bak"), "text");
  assert.equal(previewKindFor("tone.wav.old"), "text");
});

test("a dot inside a directory name is not an extension", () => {
  assert.equal(extensionOf("v1.2/README"), "");
  assert.equal(previewKindFor("v1.2/README"), "text");
  assert.equal(extensionOf("E:\\repo\\a.b\\notes"), "");
});

test("extensions are matched case-insensitively and with either separator", () => {
  assert.equal(extensionOf("E:\\shots\\Logo.PNG"), ".png");
  assert.equal(previewKindFor("E:\\shots\\Logo.PNG"), "image");
  assert.equal(extensionOf("dir/sub/clip.WAV"), ".wav");
  assert.equal(previewKindFor("dir/sub/clip.WAV"), "audio");
});

test("mime types are the ones a data URL needs", () => {
  assert.equal(mediaMimeFor("a.png"), "image/png");
  assert.equal(mediaMimeFor("a.JPG"), "image/jpeg");
  assert.equal(mediaMimeFor("a.svg"), "image/svg+xml");
  assert.equal(mediaMimeFor("a.wav"), "audio/wav");
  assert.equal(mediaMimeFor("a.mp3"), "audio/mpeg");
  assert.equal(mediaMimeFor("a.ts"), null);
  assert.equal(mediaMimeFor("noext"), null);
});

test("a dotfile has no media kind", () => {
  assert.equal(extensionOf(".gitignore"), ".gitignore");
  assert.equal(previewKindFor(".gitignore"), "text");
  assert.equal(mediaMimeFor(".gitignore"), null);
});
