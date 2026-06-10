const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: "dist",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Built ${result.outputs.length} files to dist/`);
