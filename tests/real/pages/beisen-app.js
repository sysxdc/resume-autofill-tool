// 北森 iTalent 网申表单（结构按 docs/beisen-phoenix.md 记录的线上页面；控件是 @beisen-phoenix 真组件）
//   .form-root > .ux-standard-form > [标题 div#GUID_Recruitment_X] + form.form#GUID_Recruitment_X（每条记录一个 .form，与标题同 id）
//   .form-item.form-item--phoenix > .form-item__title > label.form-item__text + 控件
//   下拉 / 日期 / 年月：.phoenix-select 宿主（只读） + unmodeled-layer 弹层（select-list / date-picker），关闭后弹层常驻 DOM
//   单选：div.phoenix-radio-group > .phoenix-radio
(function () {
  var h = React.createElement;
  var P = window.Phoenix;
  var DatePicker = P.DatePicker;
  var MonthPicker = P.MonthPicker;

  var SCHOOLS = ['北京大学', '清华大学', '某大学', '某理工大学', '某理工大学珠海校区', '某师范大学', '某财经大学', '某医科大学'];
  var OPTS = {
    pol: ['中共党员', '中共预备党员', '共青团员', '群众'],
    hd: ['大专', '本科', '硕士', '博士'],
    deg: ['大专', '本科', '硕士', '博士'],
    mode: ['全日制', '非全日制'],
    school: SCHOOLS
  };

  function App() {
    var st = React.useState({}); var s = st[0], set = st[1];
    var vs = React.useState(''); var open = vs[0], setOpen = vs[1];
    window.__state = function () { return JSON.parse(JSON.stringify(s)); };
    function put(k, v) { set(function (p) { var o = Object.assign({}, p); o[k] = v; return o; }); }

    function item(label, ctl, key) {
      return h('div', { className: 'form-item form-item--phoenix', key: key || label },
        h('div', { className: 'form-item__title' }, h('label', { className: 'form-item__text' }, label)),
        h('div', { className: 'form-item__content' }, ctl));
    }
    function input(k, label) {
      return item(label, h(P.Input, { value: s[k] || '', onChange: function (e) { put(k, e && e.target ? e.target.value : e); } }), k);
    }
    function host(k, content) {
      var active = open === k;
      return h(P.Layer, {
        key: k, trigger: 'click', visible: active, destroyPopupOnHide: false,
        onVisibleChange: function (v) { setOpen(v ? k : ''); },
        content: content
      }, h('div', null, h(P.Select, { value: s[k] || '', readOnly: true, isActive: active, placeHolder: '请选择' })));
    }
    function select(k, label, optKey) {
      var options = (OPTS[optKey || k] || []).map(function (t) { return { value: t, label: t }; });
      return item(label, host(k, h(P.SelectList, {
        options: options, showSearch: options.length > 6, isLocalSearch: true,
        onSelect: function (params) { put(k, params.selectOption.label); setOpen(''); }
      })), k);
    }
    function date(k, label, month) {
      var Picker = month ? MonthPicker : DatePicker;
      return item(label, host(k, h(Picker, {
        onSelect: function (m) { if (!m) return; put(k, m.format(month ? 'YYYY-MM' : 'YYYY-MM-DD')); setOpen(''); }
      })), k);
    }
    function radios(k, label, opts) {
      return item(label, h('div', { className: 'phoenix-radio-group' }, opts.map(function (t) {
        return h(P.Radio, { key: t, value: t, label: t, checked: s[k] === t, onChange: function () { put(k, t); } });
      })), k);
    }
    function section(id, title, rows) {
      return [h('div', { id: id, key: id + 't', className: 'form-title' }, title)].concat(rows.map(function (r, i) {
        return h('form', { id: id, key: id + i, className: 'form' }, r);
      }));
    }
    return h('div', { className: 'form-root' }, h('div', { className: 'ux-standard-form' },
      section('A1B2_Recruitment_Basic', '个人信息', [[
        input('name', '姓名'), radios('gender', '性别', ['男', '女']), date('birth', '出生日期'),
        input('phone', '手机号码'), input('email', '电子邮箱'), select('pol', '政治面貌'), select('hd', '最高学历'),
        radios('fresh', '是否应届生', ['是', '否']), date('report', '预计报到时间', true),
        input('emName', '紧急联系人'), input('emPhone', '紧急联系电话')
      ]]),
      section('C3D4_Recruitment_Edu', '教育经历', [0, 1].map(function (i) {
        return [select('school' + i, '学校名称', 'school'), input('major' + i, '专业名称'), select('deg' + i, '学历', 'deg'),
          select('mode' + i, '学习形式', 'mode'), date('es' + i, '开始时间', true), date('ee' + i, '结束时间', true)];
      })),
      section('E5F6_Recruitment_Work', '工作经历', [[
        input('co', '公司名称'), input('ti', '职位名称'), date('ws', '开始时间', true), date('we', '结束时间', true)
      ]])));
  }
  ReactDOM.render(h(App), document.getElementById('root'));
})();
