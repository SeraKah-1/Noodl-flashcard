import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProvenance,PROVENANCE_KINDS} from '../worker/validation.js';
import {TOOLS} from '../worker/index.js';

const all=['file','slide','web','generated','manual'];
test('all five canonical provenance kinds are explicit',()=>{
 assert.deepEqual(PROVENANCE_KINDS,all);
 for(const kind of all.filter(k=>k!=='web'))assert.equal(validateProvenance({kind,origin:'atlas.pdf',sourcePage:6}).kind,kind);
});
test('older type alias is normalized to kind without losing provenance fields',()=>{
 const p=validateProvenance({type:'slide',origin:'SKILL_LAB_Atlas_Ilustrasi.pdf',sourcePage:6,description:'Real PDF figure'});
 assert.equal(p.kind,'slide');assert.equal(p.origin,'SKILL_LAB_Atlas_Ilustrasi.pdf');assert.equal(p.sourcePage,6);assert.equal(p.description,'Real PDF figure');
 assert.equal('type' in p,false);
});
test('conflicting or unrecognized kind shows actionable error; never infer fabricated provenance',()=>{
 assert.throws(()=>validateProvenance({kind:'pdf',origin:'atlas.pdf'}),/provenance.kind.*file.*slide/);
 assert.throws(()=>validateProvenance({type:'uploaded_pdf',origin:'atlas.pdf'}),/provenance.kind.*slide/);
 assert.throws(()=>validateProvenance({origin:'atlas.pdf'}),/provenance.kind.*slide/);
 assert.throws(()=>validateProvenance({kind:'slide',type:'file',origin:'atlas.pdf'}),/Conflicting provenance/);
 assert.throws(()=>validateProvenance({kind:'slide',origin:''}),/source origin/);
});
test('web licensing constraints survive alias support',()=>{
 assert.throws(()=>validateProvenance({type:'web',origin:'https://example.com/image.png'}),/license/);
 assert.equal(validateProvenance({type:'web',origin:'https://example.com/page',license:'CC-BY',licenseEvidenceUrl:'https://example.com/license'}).kind,'web');
});
test('MCP registry exposes provenance enum and origin to the model on every ingest path',()=>{
 for(const name of ['import_media_bytes','begin_media_upload','app_begin_media_upload','import_media_url']){
  const spec=TOOLS.find(t=>t.name===name)?.inputSchema.properties.provenance;
  assert(spec,`${name}: schema missing`);assert.equal(spec.type,'object');assert.deepEqual(spec.properties.kind.enum,all);
  assert(spec.properties.origin.description);assert(spec.properties.sourcePage.description);
  assert(spec.required.includes('origin'));assert(spec.anyOf.some(p=>p.required.includes('kind')));
  assert(spec.anyOf.some(p=>p.required.includes('type')));
 }
});
