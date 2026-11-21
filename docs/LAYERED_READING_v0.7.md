# Noodl Flashcards v0.7 — Layered Reading dan anti-cutoff

**Status:** implemented and tested in the standalone v0.7 source, **not deployed to the currently connected ChatGPT plugin**.

## Akar bug dan perbaikannya

Masalah lama berasal dari `.face-content { display:flex; justify-content:center; overflow:auto }` di dalam kartu 3D berukuran terbatas. Konten yang lebih tinggi daripada ruang kartu dapat berada di atas awal area scroll. `pointer capture` dari seluruh kartu juga bisa mengganggu gerakan scroll di tengah teks.

Perubahan:

1. `.flash-stage` kini mempunyai `height` eksplisit responsif, dan permukaan 3D serta wajah kartu mengisi tinggi tersebut.
2. `.face-content` menggunakan `justify-content:flex-start`, `min-height:0`, `overflow-y:auto`, `touch-action:pan-y`, dan seluruh teks tetap dirender utuh. Pertanyaan pendek dapat kembali berada di tengah memakai margin otomatis yang runtuh ketika overflow.
3. Scroll konten dimulai pada `scrollTop=0` setiap flip. Fokus keyboard mengikuti sisi yang sedang terlihat.
4. `pointer capture` tidak langsung diambil dari area teks; hanya ditangkap setelah gerakan horizontal terdeteksi. Swipe kiri/kanan tetap bekerja di bagian tengah kartu, tap tetap flip, gambar tetap dapat diperbesar.
5. Tombol **Baca lengkap** tersedia di bawah setiap kartu. Layar pembaca memiliki scroll vertikal sendiri, dari paling awal sampai paling akhir. Pada HP tampil sebagai lembar baca hampir penuh; pada desktop sebagai panel samping.
6. Tombol Pertanyaan/Jawaban di pembaca tidak boleh membocorkan jawaban sebelum kartu di-flip. Pembaca menjeda timer; saat ditutup, timer normal melanjutkan sesuai keadaan kartu.
7. Existing `back` blocks tidak dipotong, tidak diganti dengan summary otomatis, dan tidak direstrukturisasi diam-diam. Semua deck dan review IDs dipertahankan.

## Kontrak konten `explanation` baru (opsional)

```json
{
  "front": [{"type": "text", "text": "Bagaimana memahami tahap ini?"}],
  "back": [{"type": "text", "text": "Jawaban inti yang ringkas."}],
  "explanation": {
    "sections": [
      {"heading": "Mekanisme", "blocks": [{"type": "text", "text": "Uraian lebih mendalam..."}]},
      {"heading": "Pengecualian", "blocks": [{"type": "text", "text": "Kondisi yang perlu dibedakan..."}]}
    ]
  },
  "clues": [
    {"atSecond": 5, "text": "Clue pertama"},
    {"atSecond": 10, "text": "Clue kedua"},
    {"atSecond": 15, "text": "Clue ketiga"}
  ],
  "timerSeconds": 20
}
```

`explanation` memakai `sections[]` dengan `heading` dan `blocks[]`, menggunakan tool MCP `create_deck`, `append_cards`, atau `update_card` yang sudah ada. Jadi tidak memerlukan tool MCP baru ataupun migrasi database: `cards.content_json` telah menyimpan JSON fleksibel.

- Batas baru: **10.000 karakter per blok teks**, maksimum **24 blok per sisi**, **16 bagian pembahasan**, 20 blok per bagian, dan **80.000 karakter teks total per kartu** (batas keamanan payload, bukan target panjang ideal). Error eksplisit bila melampaui batas—bukan memotong teks secara diam-diam.
- Penjelasan mendukung blok teks, math, dan embed video yang sudah di-allowlist. Untuk gambar, **tetap gunakan blok `back`** dan gerbang persetujuan visual per kartu. Gambar dalam `explanation.sections[].blocks` saat ini sengaja ditolak karena binding persetujuan khusus pembahasan belum tersedia; ini mencegah bypass validasi gambar.
- Menyunting penjelasan mengubah `semanticHash` kartu dan membatalkan binding verifikasi gambar lama jika relevan. Pembuktian sumber dan persetujuan harus diulang.
- Kartu lama tanpa `explanation` tetap dapat dibaca lengkap di panel pembaca.
- Untuk tilik OSCE, `procedureStep` dan urutan nomor tetap seperti versi 0.6; pembahasan panjang hanya melengkapi prosedur, bukan menggantikan teks langkah atau sumber resmi.

## Cara menguji

```sh
npm run check
npm test
python scripts/smoke_long_text.py
python scripts/smoke_gestures.py
python scripts/smoke_osce.py
python scripts/smoke_chunk_upload.py
```

`smoke_long_text.py` menguji Chromium pada 1366×900, 390×844, 320×568, dan 844×390, memakai teks depan/belakang serta pembahasan yang sangat panjang. Ia memastikan baris awal terlihat, scroll wheel bergerak, baris akhir tercapai, tab pembaca reset ke atas, tidak ada kebocoran jawaban, dan rating berfungsi setelah panel ditutup. Ini **simulasi browser**, bukan uji pada perangkat Android/iOS fisik atau backend produksi.

## Deploy

1. Backup D1 dan R2, pertahankan database yang memuat deck serta review saat ini.
2. Deploy Worker + UI + cache service worker v0.7; verifikasi MCP `get_capabilities.version` dan `initialize.serverInfo.version` menjadi `0.7.0`.
3. Refresh daftar tool ChatGPT agar prompt/kontrak pembuatan kartu mengenali `explanation`.
4. Periksa kartu lama dengan jawaban panjang (terutama Serologi Tifoid) di desktop dan HP sungguhan, lalu deck OSCE berurutan dan unggah gambar dengan approval.
5. Jangan mengklaim fitur aktif sebelum pengujian di plugin yang benar-benar terhubung. **Tidak perlu SQL migration baru untuk v0.7.**
