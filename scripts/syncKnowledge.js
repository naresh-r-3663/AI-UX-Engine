const { execSync } = require('child_process');

function run(step, cmd) {
  console.log(`\\n[${step}] ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  // Skip fetch when user wants to regenerate from existing local Tokens/meta/figma-file.json.
  const skipFetch = process.env.SKIP_FETCH === '1';

  if (!skipFetch) {
    run('1/3', 'node scripts/fetchFigma.js');
  } else {
    console.log('\\n[1/3] Skipped fetch step (SKIP_FETCH=1)');
  }

  run('2/3', 'node scripts/extractDesignData.js');
  run('3/3', 'node scripts/generateKnowledge.js');

  console.log('\\nKnowledge sync complete.');
}

main();
