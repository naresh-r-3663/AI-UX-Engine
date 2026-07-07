const fs = require('fs');
const path = require('path');

const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

async function main() {
  const figmaToken = process.env.FIGMA_TOKEN;
  const fileKey = process.env.FIGMA_FILE_KEY;
  const outputFile = process.env.FIGMA_OUTPUT_FILE || 'Tokens/meta/figma-file.json';

  if (!figmaToken) {
    throw new Error('Missing FIGMA_TOKEN environment variable.');
  }

  if (!fileKey) {
    throw new Error('Missing FIGMA_FILE_KEY environment variable.');
  }

  const url = `https://api.figma.com/v1/files/${fileKey}`;
  const response = await fetch(url, {
    headers: { 'X-Figma-Token': figmaToken }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Figma API request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const outputPath = path.resolve(process.cwd(), outputFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${outputFile}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
