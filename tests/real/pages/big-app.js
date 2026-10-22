// 大表单：基本信息 14 文本 + 10 下拉（部分值对不上）+ 2 段教育（起止范围 + 学校 + 专业 + 学历下拉）+ 2 段工作（公司 + 职位 + 开始/结束）
(function () {
  var h = React.createElement, antd = window.antd;
  var Form = antd.Form, Input = antd.Input, Select = antd.Select, DatePicker = antd.DatePicker, RangePicker = DatePicker.RangePicker;
  function fmt(v) { if (!v) return v; if (Array.isArray(v)) return v.map(fmt); if (v.format) return v.format('YYYY-MM-DD'); return v; }
  function App() {
    var st = React.useState({}); var s = st[0], set = st[1];
    function up(k) { return function (v) { var val = v && v.target ? v.target.value : v; set(function (p) { var o = Object.assign({}, p); o[k] = val; return o; }); }; }
    window.__state = function () { var o = {}; Object.keys(s).forEach(function (k) { o[k] = fmt(s[k]); }); return o; };
    var item = function (k, label, ctl) { return h(Form.Item, { label: label, key: k }, ctl); };
    var inp = function (k, label) { return item(k, label, h(Input, { value: s[k], onChange: up(k) })); };
    var sel = function (k, label, opts) { return item(k, label, h(Select, { style: { width: 220 }, value: s[k], onChange: up(k) }, opts.map(function (t) { return h(Select.Option, { key: t, value: t }, t); }))); };
    var basic = [inp('name', '姓名'), inp('phone', '手机号码'), inp('email', '邮箱'), inp('wechat', '微信号'), inp('idNumber', '身份证号'),
      inp('nativePlace', '籍贯'), inp('address', '详细地址'), inp('emName', '紧急联系人姓名'), inp('emPhone', '紧急联系人电话'),
      inp('father', '父亲姓名'), inp('hobby', '兴趣爱好'), inp('qq', 'QQ号码'), inp('salary', '期望薪资'), inp('city', '期望城市'),
      sel('gender', '性别', ['男', '女']), sel('pol', '政治面貌', ['中共党员', '共青团员', '群众']), sel('eth', '民族', ['汉族', '回族', '满族']),
      sel('mar', '婚姻状况', ['未婚', '已婚']), sel('hd', '最高学历', ['本科', '硕士', '博士']), sel('adj', '是否服从调剂', ['是', '否']),
      sel('lang', '外语等级', ['CET-4', 'CET-6', 'TEM-8']), sel('src', '招聘渠道', ['官网', '内推', '校园宣讲']), sel('health', '健康状况', ['良好', '一般']),
      sel('fresh', '是否应届生', ['是', '否']),
      item('birth', '出生日期', h(DatePicker, { value: s.birth, onChange: up('birth') }))];
    var edu = [0, 1].map(function (i) { return h('div', { className: 'sec', key: 'e' + i }, h('h3', null, '教育经历'), h(Form, null,
      item('er' + i, '起止时间', h(RangePicker, { value: s['er' + i], onChange: up('er' + i) })),
      inp('school' + i, '学校名称'), inp('major' + i, '专业'),
      sel('deg' + i, '学历', ['本科', '硕士', '博士']))); });
    var work = [0, 1].map(function (i) { return h('div', { className: 'sec', key: 'w' + i }, h('h3', null, '工作经历'), h(Form, null,
      inp('co' + i, '公司名称'), inp('ti' + i, '职位名称'),
      item('ws' + i, '开始时间', h(DatePicker, { value: s['ws' + i], onChange: up('ws' + i) })),
      item('we' + i, '结束时间', h(DatePicker, { value: s['we' + i], onChange: up('we' + i) })))); });
    return h('div', null, h('div', { className: 'sec' }, h('h3', null, '基本信息'), h(Form, null, basic)), edu, work);
  }
  var root = document.getElementById('root');
  if (ReactDOM.createRoot) ReactDOM.createRoot(root).render(h(App)); else ReactDOM.render(h(App), root);
})();
