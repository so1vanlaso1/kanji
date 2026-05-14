# Kanji Han Viet Trainer

## Lessons

Put lesson files in the `lesson/` folder. Each `.csv` file becomes one lesson in
the lesson picker, and the lesson name comes from the file name.

Example:

```text
lesson/trang2.csv -> trang2
lesson/kanji1.csv -> kanji1
```

Expected CSV columns:

```csv
Kanji,HanViet,nghia
日,NHAT,mat troi
月,NGUYET,mat trang
```

Only the `Kanji` and `HanViet` columns are used by the trainer. Extra columns,
including meanings, are ignored during testing.

When running the Vite dev server, refresh the page after adding a new lesson
file. For a production build, run `npm run build` again so the new file is
included.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```
