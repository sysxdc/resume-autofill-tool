import path from 'node:path';
export function createReliabilityCases({loadExtension,ok,eq,root}) {
  const file='reliability.html';
  const message = (page, msg) => page.evaluate(m=>new Promise(resolve=>window.__contentListeners.at(-1)(m,{},resolve)),msg);
  return [
    {name:'reliability：零填写时仍明确展示未验证 iframe',file,async run(page){
      await loadExtension(page,{name:'测试人'});
      await page.evaluate(()=>window.__resumeAutofill.fill=async()=>({ok:true,filled:0,filledKeys:[],unfilled:[],unverifiedFrames:[{frameId:9,reason:'frame_inaccessible'}]}));
      await page.addScriptTag({path:path.join(root,'content/panel.js')});
      await page.click('#__ra_panel_host__ [data-act="fill"]');
      await page.waitForFunction(()=>document.querySelector('#__ra_panel_host__').shadowRoot.textContent.includes('部分 iframe 未验证'));
      ok(await page.evaluate(()=>document.querySelector('#__ra_panel_host__').shadowRoot.textContent.includes('部分 iframe 未验证')),'不能用未发现字段掩盖未验证的 frame');
    }},
    {name:'reliability：日期原生 select 不选禁用项，重复 value 保持启用项身份',file,async run(page){
      await page.evaluate(()=>document.querySelector('#fixture').innerHTML='<div class="form-item"><label>出生日期</label><select id="year" aria-label="出生年"><option value="">年</option><option disabled value="2000">2000</option><option value="2000">2000</option></select><select id="month" aria-label="出生月"><option value="">月</option><optgroup disabled><option value="1">1</option></optgroup></select><select id="day" aria-label="出生日"><option value="">日</option><option value="1">1</option></select></div>');
      await loadExtension(page,{birthday:'2000-01-01'});
      const blocked=await page.evaluate(()=>ResumeAutofillContent.fillDateGroup(document.querySelector('#year'),'2000-01-01'));
      eq(blocked?.reason,'month_not_available','禁用月份使预检失败');eq(await page.inputValue('#month'),'','禁用月份保持空');
      const shared=await page.evaluate(()=>[ResumeAutofillDateStrategies.setSelectByNumber(document.querySelector('#year'),'2000'),ResumeAutofillDateStrategies.setSelectByNumber(document.querySelector('#month'),'1')]);
      eq(JSON.stringify(shared),JSON.stringify([true,false]),'通用日期策略同样过滤禁用项');
      eq(await page.evaluate(()=>document.querySelector('#year').selectedIndex),2,'选中启用的重复项');
      await page.evaluate(()=>{document.querySelector('#year').selectedIndex=0;document.querySelector('optgroup').disabled=false;});
      const allowed=await page.evaluate(()=>ResumeAutofillContent.fillDateGroup(document.querySelector('#year'),'2000-01-01'));
      eq(allowed?.ok,true,'可用日期组正常写入');eq(await page.evaluate(()=>document.querySelector('#year').selectedIndex),2,'日期组保持启用项身份');
    }},
    {name:'reliability：纯主字段遇到另一所已填学校时不补旧专业',file,async run(page){
      await page.evaluate(()=>document.querySelector('#fixture').innerHTML='<fieldset><legend>教育经历</legend><div class="resume-entry"><label>学校<input value="页面已有大学"></label><label>专业<input id="major"></label></div></fieldset>');
      await loadExtension(page,{school:'资料里的旧大学',major:'旧专业'});
      const r=await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false,allowCustomSelect:false}));
      eq(await page.inputValue('#major'),'','身份冲突时留空');ok(r.skipped.some(x=>x.reason==='record_conflict'),'明确冲突');
    }},
    {name:'reliability：多个 Shadow root 的同 ID 教育行各取独立记录',file,async run(page){
      await page.evaluate(()=>{
        for(let i=0;i<3;i++){const host=document.createElement('section');document.querySelector('#fixture').append(host);host.attachShadow({mode:'open'}).innerHTML='<fieldset><legend>教育经历</legend><label>学校<input id="same"></label><label>专业<input id="major"></label></fieldset>';}
      });
      await loadExtension(page,{eduList:[{school:'甲校',major:'甲专业'},{school:'乙校',major:'乙专业'},{school:'丙校',major:'丙专业'}]});
      await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false,allowCustomSelect:false}));
      const rows=await page.evaluate(()=>Array.from(document.querySelectorAll('section')).map(host=>[host.shadowRoot.querySelector('#same').value,host.shadowRoot.querySelector('#major').value]));
      eq(JSON.stringify(rows),JSON.stringify([['甲校','甲专业'],['乙校','乙专业'],['丙校','丙专业']]),'跨 root 不重复第一段');
    }},
    {name:'reliability：三段普通经历倒序，学校类型与排名只取绑定记录',file,async run(page){
      await page.evaluate(()=>document.querySelector('#fixture').innerHTML='<fieldset><legend>教育经历</legend>'+['丙校','甲校','乙校'].map((name,i)=>'<div class="resume-entry"><label>学校<input id="school'+i+'" value="'+name+'"></label><label>专业<input id="major'+i+'"></label><label>院校类型<input id="type'+i+'"></label><label>班级排名<input id="class'+i+'"></label><label>专业人数<input id="size'+i+'"></label></div>').join('')+'</fieldset>');
      await loadExtension(page,{school:'旧学校',major:'旧专业',schoolType:'旧类型',classRank:'旧排名',majorClassSize:'999',eduList:[{school:'甲校',major:'甲专业',schoolType:'985',classRank:'1/40',majorClassSize:'120'},{school:'乙校',major:'乙专业'},{school:'丙校',major:'丙专业',classRank:'2/50'}]});
      const r=await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false,allowCustomSelect:false}));
      for(const [id,want] of [['major0','丙专业'],['major1','甲专业'],['major2','乙专业'],['type0',''],['type1','985'],['type2',''],['class0','2/50'],['class1','1/40'],['class2',''],['size1','120'],['size2','']]) eq(await page.inputValue('#'+id),want,id);
      ok(!r.audit?.wrongFill,'无跨记录错填');
    }},
    {name:'reliability：AI 部分返回覆盖三段，fieldId 抵抗插入与替换',file,async run(page){
      await page.evaluate(()=>document.querySelector('#fixture').innerHTML='<fieldset><legend>教育经历</legend>'+[0,1,2].map(i=>'<div class="resume-entry"><label>学校<input id="s'+i+'"></label><label>专业<input id="m'+i+'"></label></div>').join('')+'</fieldset>');
      await loadExtension(page,{eduList:[{school:'甲校',major:'甲专业'},{school:'乙校',major:'乙专业'},{school:'丙校',major:'丙专业'}]});
      await page.addScriptTag({path:path.join(root,'shared/profile.js')});
      await page.addScriptTag({path:path.join(root,'shared/ai.js')});
      const collected=await message(page,{type:'COLLECT_FIELDS'});
      const mapped=await page.evaluate(fields=>ResumeAutofillAI.mergeAiMappingWithProfile([{index:0,action:'fill',profileKey:'school',value:'错误模型值',confidence:.99}],fields,{eduList:[{school:'甲校',major:'甲专业'},{school:'乙校',major:'乙专业'},{school:'丙校',major:'丙专业'}]}),collected.fields);
      await page.evaluate(()=>{const label=document.createElement('label');label.innerHTML='电子邮箱<input id="inserted">';document.querySelector('#fixture').prepend(label);});
      const r=await message(page,{type:'APPLY_MAPPINGS',mappings:mapped});
      eq(r.filled,6,'不受数组下标移动影响');eq(await page.inputValue('#inserted'),'','新字段不能被旧 index 命中');
      for(const [id,want] of [['s0','甲校'],['m1','乙专业'],['s2','丙校']])eq(await page.inputValue('#'+id),want,id);
      const again=await message(page,{type:'COLLECT_FIELDS'});
      await page.evaluate(()=>{const old=document.querySelector('#s0');const fresh=old.cloneNode();fresh.value='';old.replaceWith(fresh);});
      const oldField=again.fields.find(f=>f.id==='s0');
      const stale=await message(page,{type:'APPLY_MAPPINGS',mappings:[{...oldField,profileKey:'school',action:'fill',confidence:.99,suggestedValue:'不得写入'}]});
      eq(stale.filled,0,'替换节点后跳过');eq(await page.inputValue('#s0'),'','同标签新节点仍为空');ok(stale.skipped.some(s=>s.reason==='stale_field_binding'),'说明绑定失效');
    }},
    {name:'reliability：嵌套 Shadow DOM 同 ID 标签隔离，桥接定位真实控件',file,async run(page){
      await page.evaluate(()=>{
        document.querySelector('#fixture').innerHTML='<label for="same">电子邮箱</label><input id="same"><div id="outer"></div>';
        const first=document.querySelector('#outer').attachShadow({mode:'open'});first.innerHTML='<label for="same">姓名</label><input id="same"><div id="inner"></div>';
        first.querySelector('#inner').attachShadow({mode:'open'}).innerHTML='<label for="same">手机号</label><input id="same">';
      });
      await loadExtension(page,{name:'测试人',email:'test@example.test',phone:'13800000000'});
      const collected=await message(page,{type:'COLLECT_FIELDS'});eq(new Set(collected.fields.map(f=>f.fieldId)).size,3,'三个不同控件身份');
      const r=await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false,allowCustomSelect:false}));
      const values=await page.evaluate(()=>{const a=document.querySelector('#outer').shadowRoot,b=a.querySelector('#inner').shadowRoot;return [document.querySelector('#same').value,a.querySelector('#same').value,b.querySelector('#same').value,ResumeAutofillContent.bridgeCall(b.querySelector('#same'),'ping')?.ok];});
      eq(JSON.stringify(values),JSON.stringify(['test@example.test','测试人','13800000000',true]),'每个 root 使用自己的标签和桥接目标');eq(r.filled,3,'全部填写');
    }},
    {name:'reliability：共享父容器的两个 ARIA 控件、说明区域、隐藏菜单与多个活动菜单',file,async run(page){
      await page.evaluate(()=>{
        document.querySelector('#fixture').innerHTML='<div><label for="a">学校</label><input id="a" role="combobox" aria-controls="hint old a-list" aria-expanded="false"><label for="b">专业</label><input id="b" role="combobox" aria-controls="b-list" aria-expanded="false"></div><p id="hint">说明文字</p><div id="old" role="listbox" hidden><div role="option">旧学校</div></div><div id="a-list" role="listbox" hidden><div role="option">测试大学</div></div><div id="b-list" role="listbox" hidden><div role="option">自动化</div></div><div id="foreign" role="listbox"><div role="option">测试大学</div></div>';
        window.foreignClicks=0;document.querySelector('#foreign').onclick=()=>window.foreignClicks++;
        for(const id of ['a','b']){const input=document.querySelector('#'+id),box=document.querySelector('#'+id+'-list');input.onclick=()=>{input.setAttribute('aria-expanded','true');box.hidden=false;};box.firstElementChild.onclick=()=>{input.value=box.textContent;input.setAttribute('aria-expanded','false');box.firstElementChild.setAttribute('aria-selected','true');box.hidden=true;input.dispatchEvent(new Event('change',{bubbles:true}));};}
      });
      await loadExtension(page,{school:'测试大学',major:'自动化'});
      const r=await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false}));
      eq(await page.inputValue('#a'),'测试大学','第一个控件');eq(await page.inputValue('#b'),'自动化','第二个控件');eq(await page.evaluate(()=>window.foreignClicks),0,'不触碰无关弹层');eq(r.filled,2,'两个控件分别计数');
      await page.evaluate(()=>{const a=document.querySelector('#a');a.value='';a.setAttribute('aria-controls','a-list foreign');document.querySelector('#a-list').hidden=false;});
      const selected=await page.evaluate(()=>ResumeAutofillContent.fillAriaSelect(document.querySelector('#a'),'测试大学','school'));
      eq(selected,false,'多个有效弹层无法唯一确认时跳过');eq(await page.evaluate(()=>window.foreignClicks),0,'歧义时未误点');
    }},
    {name:'reliability：禁用原生选项和分组不可选，重复 value 选择真实启用项',file,async run(page){
      await page.evaluate(()=>document.querySelector('#fixture').innerHTML='<label>性别<select id="gender"><option value="">请选择</option><option disabled value="F">女</option><optgroup disabled><option value="F">女</option></optgroup><option value="F">女</option></select></label><label>最高学历<select id="degree"><option value="">请选择</option><optgroup disabled><option>硕士</option></optgroup></select></label>');
      await loadExtension(page,{gender:'女',highestDegree:'硕士'});
      await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false,allowCustomSelect:false}));
      eq(await page.evaluate(()=>document.querySelector('#gender').selectedIndex),3,'不能通过重复 value 选到禁用项');eq(await page.inputValue('#degree'),'','禁用分组保持空值');
    }},
    {name:'reliability：空多选按显式集合写入，已有选择保留，自由文本不拆分',file,async run(page){
      await page.evaluate(()=>{
        document.querySelector('#fixture').innerHTML='<label>意向城市<select multiple id="cities"><option>深圳</option><option>上海</option><option disabled>广州</option></select></label><label>意向行业<select multiple id="existing"><option selected>制造业</option><option>互联网</option></select></label><label>技术技能<button id="skills" role="combobox" aria-controls="skills-list" aria-expanded="false">请选择</button></label><div id="skills-list" role="listbox" aria-multiselectable="true" hidden><div role="option" aria-selected="false">Rust</div><div role="option" aria-selected="false">C++</div></div><label>软件技能<select multiple id="free"><option>Excel</option><option>Word</option></select></label>';
        const button=document.querySelector('#skills'),box=document.querySelector('#skills-list');button.onclick=()=>{box.hidden=false;button.setAttribute('aria-expanded','true');};box.querySelectorAll('[role="option"]').forEach(option=>option.onclick=()=>option.setAttribute('aria-selected',option.getAttribute('aria-selected')==='true'?'false':'true'));
      });
      await loadExtension(page,{softwareSkills:'Excel、Word',multiValues:{expectedCity:['深圳','上海'],expectedIndustry:['互联网'],techSkills:['Rust','C++']}});
      const r=await page.evaluate(()=>window.__resumeAutofill.fill({allowAddSections:false}));
      const sets=await page.evaluate(()=>['cities','existing','skills','free'].map(id=>ResumeAutofillContent.readMultiValues(document.querySelector('#'+id))));
      eq(JSON.stringify(sets),JSON.stringify([['深圳','上海'],['制造业'],['Rust','C++'],[]]),'多选来源及已有选择策略');
      ok(!r.audit?.wrongFill && r.audit?.entries.filter(e=>e.level==='set').length===2,'按集合审计：'+JSON.stringify(r.audit));
    }},
    {name:'reliability：异步联动等待下一级更新，忽略另一字段的打开菜单',file,async run(page){
      await page.evaluate(()=>{
        document.querySelector('#fixture').innerHTML='<select id="parent"><option value="">请选择</option><option>英语</option></select><select id="child" disabled><option value="">请选择</option><option>CET-4</option></select><div role="listbox"><div role="option" id="foreign-option">CET-4</div></div>';
        window.foreignClicks=0;document.querySelector('#foreign-option').onclick=()=>window.foreignClicks++;
        document.querySelector('#parent').onchange=()=>{const child=document.querySelector('#child');child.setAttribute('aria-busy','true');setTimeout(()=>{child.innerHTML='<option value="">请选择</option><option value="correct">CET-4</option>';child.disabled=false;child.setAttribute('aria-busy','false');},450);};
      });
      await loadExtension(page,{});
      const r=await page.evaluate(()=>ResumeAutofillSelectChain.fillChain([{host:document.querySelector('#parent'),value:'英语'},{host:document.querySelector('#child'),value:'CET-4'}]));
      eq(r.ok,true,'更新后选择');eq(await page.inputValue('#child'),'correct','写入新菜单值');eq(await page.evaluate(()=>window.foreignClicks),0,'忽略其他菜单');
    }},
    {name:'reliability：异步联动没有 busy 提示也不能选择缓存的同名旧选项',file,async run(page){
      await page.evaluate(()=>{
        document.querySelector('#fixture').innerHTML='<select id="parent"><option value="">请选择</option><option>英语</option></select><select id="child"><option value="">请选择</option><option value="stale">CET-4</option></select>';
        document.querySelector('#parent').onchange=()=>setTimeout(()=>document.querySelector('#child').innerHTML='<option value="">请选择</option><option value="fresh">CET-4</option>',450);
      });
      await loadExtension(page,{});
      const result=await page.evaluate(()=>ResumeAutofillSelectChain.fillChain([{host:document.querySelector('#parent'),value:'英语'},{host:document.querySelector('#child'),value:'CET-4'}]));
      eq(result.ok,true,'等待选项值变化后继续');eq(await page.inputValue('#child'),'fresh','不能选中刷新前同名项');
    }},
    {name:'reliability：资料编辑增删排序往返保留未知嵌套数据和未渲染字段',file,async run(page){
      await page.addInitScript(()=>{
        window.testStore={profile:{name:'测试人',schoolEnglish:'Example University',labName:'未渲染保留',extra:{top:[1,2]},eduList:[{school:'甲校',extra:{lab:['A']}},{school:'乙校',extra:{lab:['B']}}]}};
        window.chrome={storage:{local:{get:(keys,cb)=>{const data=structuredClone(window.testStore);if(cb)cb(data);else return Promise.resolve(data);},set:(value,cb)=>{Object.assign(window.testStore,structuredClone(value));if(cb)cb();else return Promise.resolve();}}},runtime:{getManifest:()=>({version:'1.9.0'})}};
        window.confirm=()=>true;
      });
      await page.goto(new URL('/options/options.html#edu',page.url()).href);await page.waitForSelector('#list-eduList .list-row');
      const before=await page.evaluate(()=>Array.from(document.querySelectorAll('#list-eduList .list-row')).map(row=>row.dataset.rowId));
      await page.click('#list-eduList button[data-list-act="down"][data-index="0"]');
      const after=await page.evaluate(()=>Array.from(document.querySelectorAll('#list-eduList .list-row')).map(row=>row.dataset.rowId));
      eq(JSON.stringify(after),JSON.stringify(before.reverse()),'会话行身份随排序保留');
      await page.click('button.list-add[data-list="eduList"]');
      await page.click('#list-eduList button[data-list-act="remove"][data-index="2"]');
      await page.evaluate(()=>document.querySelector('[name="labName"]').remove());
      await page.evaluate(()=>document.querySelector('#profile-form').requestSubmit());
      await page.waitForFunction(()=>window.testStore.profile.eduList[0].school==='乙校');
      const saved=await page.evaluate(()=>window.testStore.profile);
      eq(saved.eduList[0].extra.lab[0],'B','乙校附加数据');eq(saved.eduList[1].extra.lab[0],'A','甲校附加数据');eq(saved.extra.top[1],2,'顶层嵌套数据');eq(saved.labName,'未渲染保留','未渲染字段保持');eq(saved.schoolEnglish,'Example University','学校英文名保持');
    }}
  ];
}
