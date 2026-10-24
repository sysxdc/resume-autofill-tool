import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const require = createRequire(import.meta.url);
const P = require('../shared/profile.js'), M = require('../shared/match.js'), AI = require('../shared/ai.js'), A = require('../shared/audit.js');

test('三段、倒序绑定和部分 AI 返回始终按同一记录取值', () => {
  const profile = {eduList:[{school:'甲校',major:'甲专业'},{school:'乙校',major:'乙专业'},{school:'丙校',major:'丙专业'}]};
  const fields = [2,0,1].map((index,i)=>({index:i,fieldId:'field-'+i,label:'学校',recordRef:{listKey:'eduList',index,field:'school'}}));
  const partial = [{index:0,action:'fill',profileKey:'school',value:'模型编造',confidence:.99}];
  assert.deepEqual(AI.mergeAiMappingWithProfile(partial,fields,profile).map(m=>m.suggestedValue),['丙校','甲校','乙校']);
  assert.deepEqual(M.heuristicMapFields(fields,profile).map(m=>m.suggestedValue),['丙校','甲校','乙校']);
  const unbound = fields.map(({recordRef,...f})=>f);
  assert.deepEqual(AI.mergeAiMappingWithProfile([{...partial[0]},{...partial[0],index:2}],unbound,profile).map(m=>m.suggestedValue),['甲校','乙校','丙校']);
  assert.equal(AI.mergeAiMappingWithProfile([{...partial[0],profileKey:'major'}],fields,profile)[0].action,'skip','结构字段不能映射为另一个子字段');
});

test('纯列表键目录包含可取值子字段，默认 AI 请求不传任何资料值', () => {
  const p = {eduList:[{school:'PRIVATE_SCHOOL',schoolType:'PRIVATE_TYPE',classRank:'PRIVATE_RANK'}],multiValues:{techSkills:['PRIVATE_SKILL']}};
  const catalog = AI.buildKeyCatalog(P,p);
  for (const key of ['school','schoolType','classRank']) assert.ok(catalog.some(x=>x.key===key),key);
  const body = JSON.stringify(AI.buildAiRequestBody({mode:'whitelist'},p,[{index:0,label:'学校',currentValue:'PRIVATE_CURRENT',recordRef:{listKey:'eduList',index:0}}]));
  for (const value of ['PRIVATE_SCHOOL','PRIVATE_TYPE','PRIVATE_RANK','PRIVATE_SKILL','PRIVATE_CURRENT']) assert.ok(!body.includes(value));
});

test('绑定记录缺值不借用其他记录，主字段补全必须同时匹配身份和日期', () => {
  const p = {school:'旧校',major:'旧专业',studyMode:'全日制',schoolType:'985',classRank:'1/40',majorClassSize:'120',eduStart:'2020-09',eduEnd:'2024-06',eduList:[{school:'新校',start:'2020-09',end:'2024-06'},{school:'另一校'}]};
  for (const key of ['major','schoolType','classRank','majorClassSize','studyMode']) {
    assert.equal(M.profileValueForOccurrence(p,key,0),'',key);
    assert.equal(M.profileValueForOccurrence(p,key,1),'',key);
  }
  p.eduList[0].school='旧校';
  assert.equal(M.profileValue(p,'major'),'旧专业');
  assert.equal(M.profileValueForOccurrence(p,'schoolType',1),'');
  p.eduList[0].start='2021-09';
  assert.equal(M.profileValue(p,'major'),'');
});

test('考试名称、成绩和日期不跨记录拼接，检查语言和证书列表', () => {
  const p = {englishLevel:'CET-4',langList:[{name:'英语',certName:'CET-6',score:'600',date:'2024-06'}],certList:[{name:'IELTS',score:'7.5',date:'2025-01'}]};
  assert.deepEqual(['englishLevel','englishScore','englishDate'].map(k=>M.profileValue(p,k)),['CET-4','','']);
  delete p.englishLevel;
  assert.deepEqual(['englishLevel','englishScore','englishDate'].map(k=>M.profileValue(p,k)),['CET-6','600','2024-06']);
  p.langList=[];
  assert.deepEqual(['englishLevel','englishScore','englishDate'].map(k=>M.profileValue(p,k)),['IELTS','7.5','2025-01']);
});

test('实习只按明确性质或完整职位词，International 公司不触发分类', () => {
  const rows=[{company:'International Holdings',title:'Engineer'},{company:'任意公司',nature:'全职',title:'Intern'},{company:'公司',title:'Software Internship'},{company:'实习公司',title:'Engineer'}];
  assert.deepEqual(M.listFor({workList:rows},'internList'),[rows[2]]);
  assert.equal(M.profileValue({workList:[rows[0]]},'workNature'),'');
  assert.equal(M.profileValue({workList:[rows[1]]},'workNature'),'全职');
  assert.equal(M.profileValue({title:'Software Intern'},'workNature'),'实习');
  assert.equal(M.profileValue({title:'International Sales'},'workNature'),'');
});

test('归一化和字段补丁往返保留未知及嵌套数据，显式多值不拆字符串', () => {
  const p={schoolEnglish:'Example University',extra:{nested:[{a:1}]},eduList:[{school:'甲',extra:{lab:['A']}},{school:'乙',extra:{lab:['B']}}],multiValues:{expectedCity:['深圳','上海','深圳'],techSkills:['C++','Rust']}};
  const n=P.normalizeProfile(p), next=P.mergeFlatOntoProfile({name:'测试人'},n);
  assert.deepEqual(next.extra,p.extra); assert.deepEqual(next.eduList[1].extra,p.eduList[1].extra);
  assert.equal(next.schoolEnglish,p.schoolEnglish);
  assert.deepEqual(M.multiValuesFor(next,'expectedCity'),['深圳','上海']);
  assert.deepEqual(M.multiValuesFor({techSkills:'C++, Rust'},'techSkills'),[]);
  const f=[{index:0,label:'意向城市',controlKind:'multi',options:[{text:'深圳',value:'SZ'},{text:'上海',value:'SH'}]}];
  assert.equal(AI.mergeAiMappingWithProfile([{index:0,action:'fill',profileKey:'expectedCity',confidence:.9}],f,p)[0].action,'fill');
  assert.equal(A.compareEntry({key:'skills',kind:'multi',expected:['Rust','C++'],actual:['C++','Rust']}).accepted,true);
});

test('schema、教育子字段和编辑入口保持一致', () => {
  const html=fs.readFileSync(new URL('../options/options.html',import.meta.url),'utf8');
  for (const key of P.PROFILE_FIELDS) assert.match(html,new RegExp('name="'+key+'"'),key);
  for (const [list,fields] of Object.entries(P.LIST_ITEM_FIELDS)) for (const field of fields) assert.ok(P.LIST_ITEM_LABELS[list][field],list+'.'+field);
  for (const key of P.MULTI_VALUE_KEYS) assert.ok(html.includes('data-multi-key="'+key+'"'),key);
});

function worker({delay={},badRun=[],reject=[],frames=[{frameId:0,result:{children:2}},{frameId:2,result:{children:1}},{frameId:3,result:{children:0}},{frameId:5,result:{children:0}}]}={}) {
  let listener;
  const calls=[];
  const chrome={runtime:{id:'trusted-extension',getManifest:()=>({version:'1.9.0'}),onInstalled:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},storage:{local:{get(keys,cb){cb({});}}},scripting:{async executeScript(){return frames;}},tabs:{async sendMessage(tab,message,target){
    calls.push({tab,message,target});
    await new Promise(resolve=>setTimeout(resolve,delay[target.frameId] || 0));
    if (reject.includes(target.frameId)) throw new Error('No receiver');
    return {ok:true,runId:badRun.includes(target.frameId)?'forged':message.runId,filled:target.frameId===0?1:2,filledKeys:['name'],unfilled:[{id:'f0',label:'未填'}],audit:{checked:1,verified:1,ok:1,entries:[],problems:[]}};
  }}};
  const context=vm.createContext({chrome,crypto:{randomUUID},importScripts(){},self:{ResumeAutofillProfile:P,ResumeAutofillMatch:M,ResumeAutofillAI:AI},setTimeout,clearTimeout,console});
  vm.runInContext(fs.readFileSync(new URL('../background/service-worker.js',import.meta.url),'utf8'),context);
  return {context,calls,send:(message,sender={id:'trusted-extension',tab:{id:7}})=>new Promise(resolve=>{const pending=listener(message,sender,resolve);if(!pending)resolve(null);})};
}

test('可信调度汇总快慢及嵌套 frame，定向且每个 frame 只收一次', async () => {
  const w=worker({delay:{0:40,2:2,3:70,5:5}});
  const r=await w.send({type:'RUN_FILL',tabId:999});
  assert.equal(r.filled,7);assert.equal(r.frames,4);assert.equal(r.audit.checked,4);assert.equal(r.unverifiedFrames.length,0);
  assert.deepEqual(w.calls.map(c=>c.target.frameId),[0,2,3,5]);
  assert.ok(w.calls.every(c=>c.tab===7 && c.message.runId===r.runId));
  assert.equal(new Set(r.unfilled.map(f=>f.id)).size,4);
});

test('错误 runId、超时和不可访问 frame 明确未验证，外部来源不允许调度', async () => {
  const w=worker({delay:{3:100},badRun:[2],reject:[5]});
  vm.runInContext('FRAME_TIMEOUT_MS=30',w.context);
  const denied=await w.send({type:'RUN_FILL'},{id:'untrusted'});
  assert.equal(denied,null);assert.equal(w.calls.length,0);
  const r=await w.send({type:'RUN_FILL'});
  assert.equal(r.filled,1);assert.equal(r.unverifiedFrames.length,3);assert.equal(r.audit.okAll,false);
  assert.ok(r.unverifiedFrames.some(f=>f.reason==='frame_timeout'));
});

test('扩展弹窗带自身 tab 时仍定向用户标签，跨 frame 字段索引全局唯一', async () => {
  const w=worker({frames:[{frameId:0,result:{children:0}}]});
  const r=await w.send({type:'RUN_FILL',tabId:42},{id:'trusted-extension',url:'chrome-extension://trusted-extension/popup/popup.html',tab:{id:99}});
  assert.equal(r.ok,true);assert.equal(w.calls[0].tab,42);
});
