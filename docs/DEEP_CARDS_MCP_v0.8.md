# Noodl v0.8 — Deep Cards + Direct MCP Content Editing

## Keputusan desain

Satu kartu tetap memiliki satu `cardId` dan satu riwayat SRS. `front` adalah pertanyaan; `back` adalah jawaban inti (halaman 1); `backPages[]` menambahkan 1–12 halaman penjelasan. Halaman boleh bertipe `procedure`, `normal`, `abnormal`, `differential`, `visual`, `explanation` atau `source`. Jangan mengisi kategori yang tidak relevan.

- **Depan:** swipe kiri/kanan tetap merekam penilaian diri dan pindah ke kartu berikutnya.
- **Belakang kartu dengan `backPages`:** swipe kiri pindah ke halaman berikutnya, kanan ke halaman sebelumnya. Gerakan di batas berhenti dan **tidak** mengirim rating. Tombol rating eksplisit selalu tersedia. Keyboard kiri/kanan untuk halaman, 1–4 untuk rating. Tap biasa tidak membalik sisi belakang Deep Cards; gunakan tombol balik atau Space.
- **Kartu lama tanpa `backPages`:** swipe belakang tetap memberi rating seperti sebelum v0.8.
- **Scroll:** gerak vertikal tetap scroll native di seluruh halaman; Baca lengkap membuka pembaca terpisah dengan navigasi halaman. Saat pembaca terbuka swipe kartu tidak aktif. Timer berhenti setelah jawaban dibuka. Pada tilik OSCE timer dan clue dinonaktifkan seperti v0.6.
- **Foto/video:** hanya blok yang didukung validator; gambar pada halaman tambahan harus diikat dengan `pageId` dan disetujui untuk pasangan gambar + kartu + isi jawaban + halaman. `sourceRefs` hanyalah metadata sumber, bukan klaim bahwa gambar telah diverifikasi.

## Bentuk data

```json
{
  "front": [{"type":"text","text":"Apa langkah selanjutnya?"}],
  "back": [{"type":"text","text":"Jawaban inti singkat."}],
  "backPages": [
    {"id":"technique","kind":"procedure","title":"Prosedur standar", "blocks":[{"type":"text","text":"Rincian teknik dan urutan."}],"sourceRefs":[{"kind":"slide","origin":"tilik.pdf","sourcePage":7}]},
    {"id":"normal","kind":"normal","title":"Temuan normal", "blocks":[{"type":"text","text":"Temuan yang didukung sumber."}]},
    {"id":"abnormal","kind":"abnormal","title":"Temuan abnormal", "blocks":[{"type":"text","text":"Temuan dan batas interpretasi."}]}
  ],
  "clues": [],
  "timerSeconds": 20,
  "procedureStep": {"order": 1,"critical":false,"checklistItem":"Butir tilik sesuai sumber","phase":"Pemeriksaan","sourceDocument":"tilik.pdf","sourcePage":7}
}
```

`backPages` opsional, total panjang teks per kartu maksimal 80 ribu karakter; satu blok teks maksimal 10 ribu karakter; semua konten tidak dipotong otomatis. `id` halaman stabil dan unik, bukan nomor posisi. Mengubah `id` berarti halaman baru sehingga perlu persetujuan media lagi. Nomor butir tilik resmi tidak boleh digeser lewat operasi edit parsial.

## Tool baca isi langsung dari ChatGPT MCP

`list_decks` memberi deck ID yang benar. Kemudian:

- `list_card_contents({deckId, offset:0, limit:25})`: daftar terurut dengan ID kartu, preview, judul/ID halaman. Gunakan `includeContent:true` untuk seluruh isi dalam rentang yang dipilih. Hindari mengambil 1000 kartu sekaligus.
- `get_card_content({deckId,cardId})`: ambil satu kartu lengkap (`front`, `back`, `backPages`, `explanation`, metadata tilik) dan `deckRevision` terkini.
- `search_card_contents({query:"crackles",deckId?,limit:30})`: cari teks dalam front, back, pembahasan dan halaman tambahan; respons menyertakan kartu yang cocok. Search saat ini memindai paling banyak 5000 kartu dari akun, bukan indeks full-text.

Semua tool hanya dapat membaca akun terautentikasi oleh trusted hosting. Tool ini **membaca database Noodl**, bukan otomatis membaca PDF yang ada di percakapan ChatGPT.

## Tool edit isi langsung dari ChatGPT MCP

`patch_card_content` mengubah bagian kartu yang dituju saja. **Panggil `get_card_content` dahulu** dan gunakan `deckRevision` untuk `expectedRevision`:

```json
{
  "operationId":"uuid-unik-per-perubahan",
  "deckId":"DECK_ID_DARI_LIST_DECKS",
  "cardId":"CARD_ID_DARI_GET_CARD_CONTENT",
  "expectedRevision":4,
  "edits":[
    {"op":"upsert_back_page","page":{"id":"abnormal","kind":"abnormal","title":"Temuan abnormal","blocks":[{"type":"text","text":"Teks revisi sesuai sumber yang sudah dicek."}]}},
    {"op":"replace_back","blocks":[{"type":"text","text":"Jawaban inti yang dipersingkat."}]}
  ]
}
```

Aksi yang didukung: `replace_front`, `replace_back`, `replace_explanation` (boleh null untuk menghapus), `replace_clues`, `replace_tags`, `replace_procedure_step` (nomor urut tidak boleh berubah), `upsert_back_page`, `remove_back_page`, `reorder_back_pages` (harus memberikan semua ID), dan `detach_images` dengan `target:"front"|"back"|"page"|"all"` (untuk `page`, sertakan `pageId`). Maksimum 20 aksi dalam satu panggilan, diproses sebagai satu perubahan kartu.

**Keamanan mutasi:** kepemilikan akun, ID kartu, revisi deck, batas teks, urutan tilik, dan idempotency operation ID divalidasi. Konflik revisi dibalas dan harus dibaca ulang, bukan ditimpa otomatis. ID kartu dan review tidak berubah. Jika ada gambar yang sudah disetujui dan isi jawaban berubah, MCP akan **menolak edit yang membiarkan gambar lama ikut terbawa**; sertakan `detach_images` secara eksplisit, lalu periksa ulang gambar setelah mengubah isi. Jangan membuat image block baru lewat patch.

## Cara memasang gambar pada halaman belakang

1. Unggah dan tinjau gambar hingga status aset `approved` (pemilihan berkas dari panel; host transfer atau chunked MCP).
2. `create_visual_candidate({deckId,cardId,mediaId,side:"back",pageId:"abnormal"})`. **Jangan isi `pageId` jika gambar ditaruh pada halaman inti `back`.**
3. `submit_source_check`, `submit_visual_check` pada **gambar final tersimpan**, bukan sekadar thumbnail internet. Keduanya adalah klaim model yang diaudit, bukan validasi ilmiah independen.
4. Pengguna melihat **judul dan isi halaman yang tepat** serta gambar resolusi penuh, lalu menyetujui dengan `app_approve_card_visual` setelah memperoleh challenge.
5. `attach_visual_to_card` memakai revisi deck terbaru. Setelah attach, baca ulang `get_card_content` dan periksa letak gambar. Gambar yang disetujui untuk halaman normal tidak dapat disisipkan ke halaman abnormal melalui `patch_card_content`.

Halaman dapat memuat gambar PNG/JPEG/WebP terverifikasi, teks, matematika, atau tautan video yang disaring. Gambar web wajib lisensi dan asal sumber jelas; jangan menyebut ilustrasi internet sebagai slide asli. Aplikasi tetap **tidak menjalankan AI provider**.

## Pembaruan data dari MCP di UI

Setelah ChatGPT menyunting kartu, pemain yang terhubung dapat menekan **Perbarui isi** untuk mengambil ulang snapshot cloud. Sistem mempertahankan kartu berjalan apabila ID-nya masih ada dan menjaga halaman terpilih sepanjang memungkinkan. Tidak ada sinkronisasi otomatis tanpa aksi yang dilakukan user. Mode lokal tidak dapat membaca mutasi akun cloud.

## Migrasi dan pengujian

**v0.7 → v0.8 butuh satu migrasi baru**: jalankan `migrations/0005_deep_cards.sql` pada **database D1 yang sama** setelah mencadangkan data dan memastikan migrasi 0001–0004 ada. Migrasi ini hanya menambah kolom nullable `visual_bindings.page_id` dan indeks baru. `backPages` tetap di `cards.content_json`, sehingga kartu, folder, dan review lama tidak dipindahkan atau diganti.

1. Deploy ulang Worker/Assets pada endpoint yang sama. Update cache service worker dan refresh registry MCP ChatGPT.
2. Pastikan `get_capabilities.version` dan `initialize.serverInfo.version` melaporkan `0.8.0`.
3. Verifikasi tool `get_card_content`, `list_card_contents`, `search_card_contents`, dan `patch_card_content` muncul pada plugin live.
4. Buat **deck tes**, edit satu halaman dengan nomor revisi benar, lalu baca kembali. Cek bahwa 64 kartu Serologi Tifoid dan review lama tetap ada sebelum dan setelah deploy.
5. Verifikasi alur visual per halaman secara nyata di backend tersambung. Browser test lokal dengan host simulasi **tidak** membuktikan izin hosting atau persetujuan pengguna produksi.

Perintah lokal:

```bash
npm run check
npm test
python scripts/smoke_deep_cards.py
python scripts/smoke_long_text.py
python scripts/smoke_gestures.py
python scripts/smoke_osce.py
python scripts/smoke_chunk_upload.py
python scripts/smoke_visual_ui.py
```
