# Noodl v0.6 — Tilik OSCE via flashcards yang sama

Bukan aplikasi/fitur OSCE terpisah. Deck yang berisi `procedureStep` pada setiap kartu akan tampil berurutan 1 → N. Player memiliki **Pelajari teknik** (pertanyaan tiap langkah) dan **Ingat urutan** (prompt "Apa tindakan selanjutnya?", tanpa bocoran isi kartu sebelum flip). Swipe tetap menilai ingatan diri; tidak memvalidasi tindakan klinis.

## Alur memakai tilik yang asli

1. Gunakan PDF/foto tilik dari lembaga pengguna; tentukan prosedur yang benar. Transkripsikan butir, nomor, sublangkah, dan kriteria penting TANPA mengarang langkah, skor, atau label `critical` jika tidak ada dalam tilik. Jika ambigu, tandai perlu konfirmasi.
2. Tiap kartu memiliki `front` (pertanyaan tindakan), `back` (tindakan yang perlu diucapkan/diperagakan), `procedureStep` dan opsional `clues: []`. Gunakan `procedureStep.order` mulai 1 dan tanpa celah. `procedureStep.checklistItem` menyimpan identitas butir sumber, sehingga nomor aslinya bisa berbeda dari nomor kartu.
3. `procedureStep.critical=true` HANYA jika sumber secara eksplisit menandai tindakan kritis. Jika tilik tidak memberi penanda, gunakan `false`, jangan menebak risiko dari uraian AI.
4. `procedureStep.sourceDocument` berisi nama sumber riil, `sourcePage` halaman PDF 1-based yang telah diperiksa (boleh null jika belum ada). Jangan klaim telah membaca sumber jika tidak ada.
5. Untuk gambar, gunakan alur visual validation Noodl yang sudah ada: impor sebagai pending → pemeriksaan asal dan relevansi pada kartu tertentu → persetujuan pengguna → attach. Jangan memalsukan assetId atau menempel ilustrasi web seolah-olah foto tilik asli. Gambar pelengkap tetap diberi provenance dan lisensi yang benar.
6. Buat lewat MCP `create_deck`; untuk 100+ kartu, lanjut `append_cards` dengan `expectedRevision` terkini dan nomor `order` 101... dst. Mengedit kartu boleh, **mengubah nomor langkah atau menghapus langkah tilik tidak diizinkan**: buat revisi deck terpisah agar tidak menghilangkan tindakan secara diam-diam.
7. Buka deck biasa di Library; pilih Pelajari teknik atau Ingat urutan. Kedua mode otomatis tanpa timer dan tanpa clue, terlepas dari Settings global. Flashcard teori tetap memakai timer 20 detik dan clue 5/10/15.

## Contoh JSON

Lihat `examples/OSCE_TILIK_DEMO_NOT_OFFICIAL.json`. Ini demonstrasi STRUKTUR, **bukan tilik resmi dan bukan prosedur klinis lengkap**. Tidak ada gambar karena belum ada foto klinis tervalidasi.

```json
{
  "front": [{"type":"text","text":"Bagaimana tindakan pada butir ini dilakukan?"}],
  "back": [{"type":"text","text":"Uraian sesuai sumber tilik resmi; sertakan foto yang telah disetujui bila ada."}],
  "clues": [],
  "timerSeconds": 20,
  "tags": ["OSCE"],
  "procedureStep": {
    "order": 1,
    "checklistItem": "Butir 1 pada dokumen resmi",
    "phase": "Pembukaan",
    "critical": false,
    "sourceDocument": "Nama PDF tilik yang benar",
    "sourcePage": 4
  }
}
```

`timerSeconds` dipertahankan sebagai properti struktur flashcard, tetapi tidak digunakan saat player mendeteksi deck tilik; `elapsedMs` disimpan 0 karena penghitungan per kartu tidak berlangsung. Tidak ada perubahan skema SQLite/D1; metadata ini sudah disimpan di kolom `content_json` yang ada. Tidak ada migrasi database. Seluruh folder dan riwayat review lama tetap kompatibel.

## Pemeriksaan penerimaan

- Nomor langkah kontigu; campuran kartu teori dan tilik dalam satu deck ditolak.
- Deck prosedur selalu urut 1→N, termasuk ketika memulai review jatuh tempo.
- Teknik: pertanyaan asli; Urutan: pertanyaan umum; action dan sumber hanya terlihat setelah flip.
- Timer dan clue dinonaktifkan hanya untuk tilik; deck biasa tidak terpengaruh.
- Gambar pending tidak dapat dipasang; dua pemeriksaan plus persetujuan pengguna tetap berlaku.
- Review self-report bukan nilai OSCE, bukti keterampilan, atau sertifikasi.
- Metadata tilik bertahan setelah create → get → append → update tanpa mengubah cardId.
