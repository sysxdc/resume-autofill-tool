import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
for (const args of [['tests/run-tests.mjs'],['tests/match-benchmark.mjs','--check'],['tests/real/run-real.mjs']]) {
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  if(r.status!==0) process.exit(r.status || 1);
  const output=(r.stdout || '')+'\n'+(r.stderr || '');
  if(/^(?:ℹ |# )skipped\s+[1-9]\d*/m.test(output) || /^\s*[（(]跳过[:：]/m.test(output) || /Result:\s*0 passed/m.test(output)) {
    throw new Error('发布验证不允许跳过必需用例或零用例：'+args[0]);
  }
  if(args[0].includes('run-tests') && (!/DOM Result:\s*[1-9]\d* passed/.test(output) || !/tests\s+[1-9]\d*/.test(output))) throw new Error('必需套件未完成');
}
if(process.argv.includes('--package')) {
  const r=spawnSync('python',['scripts/package.py'],{cwd:root,stdio:'inherit'});
  if(r.status!==0) process.exit(r.status || 1);
}
