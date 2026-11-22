# Perbaikan `Invalid provenance type` — v0.10.1

Bug sebenarnya: `worker/validation.js` mengharuskan `provenance.kind`, tetapi `worker/index.js` sebelumnya mengiklankan objek `provenance` tanpa properti wajib atau enum jenis sumber. Kesalahan ini terjadi sebelum file dimasukkan ke R2, jadi daftar media tetap kosong.

## Contoh sumber PDF / slide yang benar

```json
{
  "operationId": "example-unique-request-id",
  "mimeType": "image/png",
  "fileName": "slide-06.png",
  "base64": "ACTUAL_PNG_BASE64_NOT_PLACEHOLDER",
  "provenance": {
    "kind": "slide",
    "origin": "SKILL_LAB_Atlas_Ilustrasi.pdf",
    "sourcePage": 6,
    "description": "Gambar asli dari halaman 6"
  }
}
```

Nilai `kind` yang valid **hanya** `file`, `slide`, `web`, `generated`, `manual`. Gambar yang diekstrak dari PDF tetap berkategori `slide`, bukan `pdf`. Contoh Base64 di atas adalah placeholder dokumentasi dan tidak bisa digunakan untuk upload.

Baru di v0.10.1: setiap MCP tool media mempublikasikan JSON Schema yang mendeskripsikan `kind`, `origin`, `sourcePage`, dan properti lisensi; klien lama yang mengirim `type:"slide"` juga diterima sebagai alias `kind:"slide"`. Jika keduanya ada dan bertentangan, server menolak. Jika kategorinya tidak valid, pesan error menyebutkan semua opsi serta contoh perbaikannya. `web` tetap harus punya lisensi reusable, URL HTTPS sumber dan bukti lisensi.

Tool yang terpengaruh: `import_media_bytes`, `begin_media_upload`, `app_begin_media_upload`, `import_media_url`. Jalur upload panel, kepemilikan akun, pemeriksaan bytes, two-stage per-card visual validation, migrasi database, dan 17 deck existing tidak diubah. **Tidak ada migrasi D1 tambahan.**

## Deployment

Deploy Worker v0.10.1 ke site Noodl yang sama, pertahankan D1 dan R2 yang sama, lalu **refresh katalog MCP tool** pada ChatGPT. Sampai tool registry diperbarui, ChatGPT dapat terus melihat kontrak lama meski endpoint backend sudah baru. Verifikasi `tools/list` benar-benar menunjukkan `provenance.properties.kind.enum`, baru uji satu gambar. Jangan klaim gambar terunggah sebelum `list_media` dan pemeriksaan gambar memastikannya.
