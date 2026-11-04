// src/lib/storage.js — images for newsletters go to the public `email-assets` bucket (migration 011):
// recipients' mail clients fetch them without credentials. Uploads are downscaled in the browser to
// 1200px wide so a phone photo does not become a 4 MB email; GIFs are kept as they are.
import { auth } from "./auth.js";

const URL_ = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const BUCKET = "email-assets";
const MAX_W = 1200, MAX_BYTES = 1.5 * 1024 * 1024;

export const publicUrl = path => `${URL_}/storage/v1/object/public/${BUCKET}/${path}`;
const slug = s => String(s || "image").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "image";

// Shrink a bitmap image when it is wider than MAX_W or heavier than MAX_BYTES. Returns {blob, type}.
export async function shrinkImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap === "undefined") return { blob: file, type: file.type };
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, type: file.type };
  if (bmp.width <= MAX_W && file.size <= MAX_BYTES) { bmp.close?.(); return { blob: file, type: file.type }; }
  const scale = Math.min(1, MAX_W / bmp.width);
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close?.();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise(res => canvas.toBlob(res, type, 0.86));
  return { blob: blob || file, type: blob ? type : file.type };
}

// Upload one image; resolves to its public URL. Needs a signed-in user (the bucket's insert policy).
export async function uploadImage(file, { folder = "newsletters" } = {}) {
  if (!URL_ || !ANON) throw new Error("Supabase is not configured");
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG, GIF or WebP image");
  const { blob, type } = await shrinkImage(file);
  if (blob.size > 5 * 1024 * 1024) throw new Error("That image is over 5 MB even after shrinking");
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[type] || "bin";
  const path = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${slug(file.name)}.${ext}`;
  const token = (await auth.token()) || ANON;
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": type, "x-upsert": "false", "Cache-Control": "public, max-age=31536000" }, body: blob });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || d.error || `Upload failed (${r.status})`); }
  return { url: publicUrl(path), path, bytes: blob.size };
}
