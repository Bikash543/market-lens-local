import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const [root,stage]=process.argv.slice(2);
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const chunks=['MARKET LENS LOCAL — THIRD-PARTY NOTICES\n\nThe following licences belong to third-party components. They do not change ownership of application code.\n'];
for(const relative of Object.keys(lock.packages).filter(p=>p.startsWith('node_modules/')).sort()){
  const directory=path.join(root,relative);
  try {
    const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
    chunks.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nDeclared licence: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license??'See package')}\n`);
    const files=(await readdir(directory)).filter(name=>/^(licen[sc]e|copying|copyright|notice)([._-]|$)/i.test(name));
    for(const file of files){
      try { chunks.push(`\n${file}\n${await readFile(path.join(directory,file),'utf8')}\n`); } catch {}
    }
  } catch {}
}
chunks.push('\nBundled stylesheet\n'+await readFile(path.join(root,'vendor','shadcn-tailwind-4.13.0.LICENSE.md'),'utf8'));
await writeFile(path.join(stage,'THIRD-PARTY-NOTICES.txt'),chunks.join('\n'));
console.log('Third-party notices written.');
