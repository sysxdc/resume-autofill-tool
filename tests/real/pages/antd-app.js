// 通用 antd 页面（v3 / v4 / v5 同一份 React 代码；差异由 window.__AV 控制）
(function () {
  var h = React.createElement;
  var antd = window.antd;
  var Form = antd.Form, Input = antd.Input, Select = antd.Select, DatePicker = antd.DatePicker;
  var MonthPicker = DatePicker.MonthPicker, RangePicker = DatePicker.RangePicker;
  var AV = window.__AV;
  function fmt(v) {
    if (!v) return v;
    if (Array.isArray(v)) return v.map(fmt);
    if (v.format) return v.format('YYYY-MM-DD');
    return v;
  }
  function App() {
    var st = React.useState({}); var s = st[0], set = st[1];
    function up(k) { return function (v) { var val = v && v.target ? v.target.value : v; set(function (p) { var o = Object.assign({}, p); o[k] = val; return o; }); }; }
    window.__state = function () { var o = {}; Object.keys(s).forEach(function (k) { o[k] = fmt(s[k]); }); return o; };
    var item = function (label, ctl) { return h(Form.Item, { label: label, key: label }, ctl); };
    var month = AV >= 4
      ? h(DatePicker, { picker: 'month', value: s.enroll, onChange: up('enroll') })
      : h(MonthPicker, { value: s.enroll, onChange: up('enroll') });
    return h('div', null,
      h('div', { className: 'sec' }, h('h3', null, '基本信息'),
        h(Form, { layout: 'horizontal' },
          item('姓名', h(Input, { value: s.name, onChange: up('name') })),
          item('学历', h(Select, { style: { width: 200 }, value: s.deg, onChange: up('deg') },
            ['本科', '硕士', '博士'].map(function (t) { return h(Select.Option, { key: t, value: t }, t); }))),
          item('出生日期', h(DatePicker, { value: s.birth, onChange: up('birth') })))),
      h('div', { className: 'sec' }, h('h3', null, '教育经历'),
        h(Form, null,
          item('起止时间', h(RangePicker, { value: s.eduRange, onChange: up('eduRange') })),
          item('入学时间', month))),
      h('div', { className: 'sec' }, h('h3', null, '工作经历'),
        h(Form, null,
          item('开始时间', h(DatePicker, { value: s.ws, onChange: up('ws') })),
          item('结束时间', h(DatePicker, { value: s.we, onChange: up('we') })))));
  }
  var root = document.getElementById('root');
  if (ReactDOM.createRoot) ReactDOM.createRoot(root).render(h(App));
  else ReactDOM.render(h(App), root);
})();
