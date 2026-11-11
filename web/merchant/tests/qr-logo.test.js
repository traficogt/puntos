import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLogoFile } from '../src/qr-logo.js';
test('logo upload accepts bounded local PNG/JPEG and explains invalid files',()=>{
 for(const type of ['image/png','image/jpeg'])assert.equal(validateLogoFile({type,size:5000}), '');
 assert.match(validateLogoFile({type:'image/svg+xml',size:5000}),/PNG|JPG/);
 assert.match(validateLogoFile({type:'image/png',size:2*1024*1024+1}),/2 MB/);
 assert.match(validateLogoFile({type:'image/png',size:0}),/vacío/);
});
