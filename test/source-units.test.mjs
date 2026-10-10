import assert from 'node:assert/strict';
import test from 'node:test';
import {deriveSourceUnitAlignments} from '../src/source-units.mjs';
import {pairKey} from '../src/segments.mjs';
function fixture({target='前甲乙後', reading='ぜんかきあと', prior, sourceStatus='aligned', sourceReading='かき', sourceSegments=[['甲','か'],['乙','き']], extraWords=[], lexicalEvidence=[]}={}) {
  const entries=[['1','甲乙',sourceReading],['2',target,reading],...extraWords];
  const jmdict={words:entries.map(([id,written,reading])=>({id,kanji:[{text:written,tags:[]}],kana:[{text:reading,tags:[],appliesToKanji:['*']}],sense:[]}))};
  const kanjidic={characters:['乙','前','後','丙'].map((literal,index)=>({literal,readingMeaning:{groups:[{readings:[{type:'ja_kun',value:[sourceReading==='かきく'?'きく':'き','ぜん','あと','く'][index]}]}]}}))};
  const bundle={schemaVersion:1,source:{name:'fixture',publisher:'Japanese Wiktionary',version:'fixture-1',sha256:'a'.repeat(64),url:'https://example.test/pinned-character-readings'},readings:[{character:'甲',reading:'カ',kind:'on',originalForm:'カ',tags:['on','transliteration']}]};
  const priorTarget=prior??{status:'aligned',segments:[[target,reading]]};
  const results=new Map(entries.map(([,w,r])=>[pairKey(w,r),{status:'aligned',segments:[[w,r]]}]));
  results.set(pairKey('甲乙',sourceReading),{status:sourceStatus,segments:sourceSegments});results.set(pairKey(target,reading),priorTarget);
  const run=(changes={})=>deriveSourceUnitAlignments(jmdict,kanjidic,(w,r)=>results.get(pairKey(w,r)),{characterReadingBundle:bundle,lexicalEvidence,nativeCompounds:false,koreanReadings:false,onReadingSpelling:false,...changes});
  return {run,priorTarget,results,kanjidic,bundle};
}
const get=(result,written,reading)=>result.wordAlignments.get(written)?.get(reading);
test('independently reallocated word contributes only its internal cut',()=>{
 const {run,priorTarget}=fixture();const result=run();assert.deepEqual(get(result,'前甲乙後','ぜんかきあと'),[['前甲','ぜんか'],['乙後','きあと']]);assert.deepEqual(priorTarget.segments,[['前甲乙後','ぜんかきあと']]);assert.equal(result.units.length,1);assert.equal(result.witnesses.length,1);assert.ok(result.witnesses[0].units[0].allocation.every(item=>item.evidence.length>0));assert.equal(result.witnesses[0].units[0].allocation[1].evidence[0].field,'ja_kun');
});
test('a source output without independent complete sound evidence cannot seed a unit',()=>{
 const {run}=fixture();assert.equal(run({characterReadingBundle:undefined}).wordAlignments.size,0);
});
test('an ambiguous or grouped source output cannot seed a unit',()=>{
 for(const opts of [{sourceStatus:'ambiguous'},{sourceSegments:[['甲乙','かき']]}])assert.equal(fixture(opts).run().wordAlignments.size,0);
});
test('a disagreeing accepted source allocation is not relearned from raw sources',()=>{
 const {run}=fixture({sourceReading:'かきく',target:'前甲乙後',reading:'ぜんかきくあと',sourceSegments:[['甲','かき'],['乙','く']]});assert.equal(run().wordAlignments.size,0);
});
test('an ambiguous target stays untouched',()=>{
 const {run}=fixture({prior:{status:'ambiguous',segments:[['前甲乙後','ぜんかきあと']]}});assert.equal(run().wordAlignments.size,0);
});
test('unwritten particle ownership stays in the residual group',()=>{
 const {run}=fixture({target:'甲乙丙',reading:'かきのく'});assert.deepEqual(get(run(),'甲乙丙','かきのく'),[['甲','か'],['乙丙','きのく']]);
});
test('existing target boundaries and their readings remain intact',()=>{
 const {run}=fixture({target:'前甲乙丙',reading:'ぜんかきのく',prior:{status:'aligned',segments:[['前','ぜん'],['甲乙丙','かきのく']]}});assert.deepEqual(get(run(),'前甲乙丙','ぜんかきのく'),[['前','ぜん'],['甲','か'],['乙丙','きのく']]);
});
test('repeated placements and a following dependent mora do not create cuts',()=>{
 for(const [target,reading] of [['前甲乙甲乙後','ぜんかきかきあと'],['甲乙丙','かきんく']])assert.equal(fixture({target,reading}).run().wordAlignments.size,0);
});
test('reviewed exact source evidence vetoes conflicting allocations',()=>{
 const fact={id:'reviewed',written:'甲乙',reading:'かきく',segments:[['甲','かき'],['乙','く']],reason:'Conflicting source allocation fixture',sources:[{url:'https://example.test/reviewed'}]};
 assert.equal(fixture({sourceReading:'かきく',target:'前甲乙後',reading:'ぜんかきくあと',sourceSegments:[['甲','か'],['乙','きく']],lexicalEvidence:[fact]}).run().wordAlignments.size,0);
});
test('reuse remains an exact attested target lookup without recursive propagation',()=>{
 const {run}=fixture({target:'甲乙丙',reading:'かきのく',extraWords:[['3','甲乙丙後','かきのくあと']]});const result=run();assert.ok(result.units.every(unit=>unit.written==='甲乙'));assert.equal(get(result,'未甲乙後','みかきあと'),undefined);
});

test('omitted source identity is explicitly bound to supplied raw characters',()=>{
 const {run}=fixture();const unit=run().units[0];const identity=unit.allocation[1].evidence[0].sourceIdentity;
 assert.match(identity.charactersSHA256,/^[\da-f]{64}$/u);assert.equal(identity.version,undefined);
 assert.throws(()=>run({kanjidicSource:null}),/source identity/);
});
test('disabling weak readings prevents nanori source-unit evidence',()=>{
 const {run,kanjidic,bundle}=fixture();kanjidic.characters=kanjidic.characters.filter(character=>character.literal!=='乙');kanjidic.characters.push({literal:'甲',readingMeaning:{nanori:['か']}});
 const supplemental={...bundle,readings:[{character:'乙',reading:'キ',kind:'on',originalForm:'キ',tags:['on','transliteration']}]};
 assert.equal(run({characterReadingBundle:supplemental}).wordAlignments.size,1);
 assert.equal(run({characterReadingBundle:supplemental,weakReadings:false}).wordAlignments.size,0);
});

test('native contraction companions retain fingerprints without upstream metadata', () => {
  const pairs = [['甲乙', 'あいうえ'], ['甲乙丙', 'あいうえお']];
  const jmdict = { words: pairs.map(([written, reading], index) => ({
    id: String(index), kanji: [{ text: written, tags: [] }],
    kana: [{ text: reading, tags: [], appliesToKanji: ['*'] }], sense: []
  })) };
  const kanjidic = { characters: [['甲', 'あいか'], ['乙', 'うえ'], ['丙', 'お']].map(([literal, value]) => ({
    literal, readingMeaning: { groups: [{ readings: [{ type: 'ja_kun', value }] }] }
  })) };
  const align = (written, reading) => ({ status: 'aligned', segments: written === '甲乙' ? [['甲', 'あい'], ['乙', 'うえ']] : [[written, reading]] });
  const result = deriveSourceUnitAlignments(jmdict, kanjidic, align, { listedPhonology: false, koreanReadings: false, onReadingSpelling: false });
  assert.deepEqual(get(result, '甲乙丙', 'あいうえお'), [['甲', 'あい'], ['乙丙', 'うえお']]);
  assert.ok(result.units[0].allocation.every(item => item.evidence.every(evidence => /^[\da-f]{64}$/u.test(evidence.sourceIdentity.charactersSHA256))));
});
