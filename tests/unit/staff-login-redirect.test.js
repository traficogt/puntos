import test from 'node:test';
import assert from 'node:assert/strict';
import * as helpers from '../../public/staff-return-path.js';
test('owner return paths preserve internal sections and reject ambiguous destinations',()=>{
 for(const value of ['/negocio/','/negocio/#region','/negocio/#movimientos','/negocio/#canjes-pos'])assert.equal(helpers.staffLoginDestination('OWNER',value),value);
 for(const value of ['https://elsewhere.test/negocio/','//elsewhere.test/negocio/','/\\elsewhere.test/negocio/','/negocio/../admin','/negocio/?demo=1','/negocio/#x%0a','/negocio/#x\n','/negocio/#<script>','/negocio/#'+'a'.repeat(100),'%2Fnegocio%2F%23region'])assert.equal(helpers.staffLoginDestination('OWNER',value),'/negocio/',value);
 assert.equal(helpers.staffLoginHref('/negocio/#region'),'/equipo/ingresar/?return_to=%2Fnegocio%2F%23region');
 assert.equal(helpers.staffLoginDestination('MANAGER','/negocio/#region'),'/administracion/');
 assert.equal(helpers.staffLoginDestination('STAFF','/negocio/#region'),'/equipo/escaner/');
});
