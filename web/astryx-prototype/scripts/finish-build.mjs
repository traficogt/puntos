import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {slideRulesCss,SLIDE_RULES_ID} from '../node_modules/@astryxdesign/core/dist/Layer/layerSlideRules.js';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const output=join(root,'../../public/revision-astryx/9b72f5a1');
// Astryx 0.7.16 normally injects this fixed positioning stylesheet at runtime.
// Ship the identical stylesheet externally and retain its sentinel ID so that
// popovers work under PF's existing CSP, without permitting inline styles.
await writeFile(join(output,'layer-slide-rules.css'),slideRulesCss());
const index=join(output,'index.html');
await writeFile(index,(await readFile(index,'utf8')).replace('</head>',`<link id="${SLIDE_RULES_ID}" rel="stylesheet" href="./layer-slide-rules.css" />\n</head>`));
const notices=[];
for(const pkg of ['@astryxdesign/core','@astryxdesign/theme-neutral','@stylexjs/stylex','react','react-dom','lucide-react']) {
 const dir=join(root,'node_modules',pkg);
 const manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
 let license='';
 for(const name of ['LICENSE','LICENSE.md','LICENSE.txt']){try{license=await readFile(join(dir,name),'utf8');break;}catch{}}
 if(!license&&pkg==='@astryxdesign/core')license=await readFile(join(root,'licenses/astryx-MIT.txt'),'utf8');
 if(!license&&pkg==='@stylexjs/stylex')license=await readFile(join(root,'licenses/stylex-MIT.txt'),'utf8');
 if(!license)throw new Error(`Missing bundled license for ${pkg}`);
 notices.push(`${pkg} ${manifest.version}\n${license}`);
}
await writeFile(join(output,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n--------\n\n'));
