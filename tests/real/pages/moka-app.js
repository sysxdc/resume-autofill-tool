// Moka（app.mokahr.com）网申表单复刻：Moka 的 sd-* 组件库未公开发布，这里按仓库记录的线上结构
// （README 1.5.10 / 1.5.16、content/autofill.js 注释）用 React 18 复刻其行为，不是真组件：
//   .apply-block（首个子节点是分区标题）> .apply-fields（一条记录）> .apply-field（一个字段）
//   字段名在带 CSS-module 哈希的 .title-xxxx > span > span 里，控件包在 <label> 里（label 文本是值 / 校验提示）
//   sd-Select：容器类名带哈希；input 是搜索框（可输入筛选），选中值渲染成 span、input.value 一直为空
//   选项 portal 到 body（.sd-Menu-content-item-xxxx），点选才提交
//   「年 / 月」下拉对：一串 sd-Select，placeholder 是「年」「月」，月份选项是 01~12
//   分块懒挂载：实习经历在 600ms 后才渲染；失焦为空时出现「必填项未填写」
(function () {
  var h = React.createElement;
  var H = '-k3x9';   // CSS-module 哈希后缀

  function MenuPortal(props) {
    return ReactDOM.createPortal(h('div', { className: 'sd-Menu-root' + H, style: { position: 'absolute', left: props.x + 'px', top: props.y + 'px', background: '#fff', border: '1px solid #ccc', maxHeight: '220px', overflow: 'auto', zIndex: 1000, minWidth: '160px' } },
      props.items.length ? props.items.map(function (t) {
        return h('div', { key: t, className: 'sd-Menu-content-item' + H, style: { padding: '4px 8px', cursor: 'pointer' },
          onClick: function () { props.onPick(t); } }, t);
      }) : h('div', { className: 'sd-Menu-empty' + H }, '暂无数据')), document.body);
  }

  function SdSelect(props) {
    var o = React.useState(false); var open = o[0], setOpen = o[1];
    var q = React.useState(''); var query = q[0], setQuery = q[1];
    var ref = React.useRef(null);
    var pos = { x: 0, y: 0 };
    if (ref.current) { var r = ref.current.getBoundingClientRect(); pos = { x: r.left + window.scrollX, y: r.bottom + window.scrollY }; }
    var items = props.options.filter(function (t) { return !query || t.indexOf(query) !== -1; });
    React.useEffect(function () {
      if (!open) return undefined;
      var close = function (e) {
        if (ref.current && ref.current.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.sd-Menu-root' + H)) return;
        setOpen(false); setQuery('');
      };
      document.addEventListener('mousedown', close);
      return function () { document.removeEventListener('mousedown', close); };
    }, [open]);
    return h('div', { ref: ref, className: 'sd-Select-container' + H + (open ? ' sd-Select-open' + H : ''), style: { position: 'relative', display: 'inline-block', width: props.width || 220, border: '1px solid #bbb', padding: '2px 4px' },
      onClick: function () { setOpen(true); } },
      props.value && !query ? h('span', { className: 'sd-Select-value' + H, style: { position: 'absolute', left: '6px', pointerEvents: 'none' } }, props.value) : null,
      h('input', { value: query, placeholder: props.value ? '' : (props.placeholder || '请选择'), style: { border: 0, outline: 0, width: '90%' },
        onChange: function (e) { setQuery(e.target.value); setOpen(true); }, onFocus: function () { setOpen(true); } }),
      open ? h(MenuPortal, { items: items, x: pos.x, y: pos.y, onPick: function (t) { props.onChange(t); setOpen(false); setQuery(''); } }) : null);
  }

  function SdInput(props) {
    var t = React.useState(false); var touched = t[0], setTouched = t[1];
    return h('label', { className: 'sd-Input-wrapper' + H },
      h('input', { value: props.value || '', placeholder: props.placeholder || '请输入', onChange: function (e) { props.onChange(e.target.value); }, onBlur: function () { setTouched(true); } }),
      touched && !props.value ? h('div', { className: 'sd-Input-error' + H, style: { color: 'red' } }, '必填项未填写') : null);
  }

  var YEARS = []; for (var y = 2030; y >= 1990; y--) YEARS.push(String(y));
  var MONTHS = []; for (var m = 1; m <= 12; m++) MONTHS.push((m < 10 ? '0' : '') + m);
  var SCHOOLS = ['北京大学', '清华大学', '某大学', '某理工大学', '某理工大学珠海校区', '某师范大学', '某财经大学'];

  function App() {
    var st = React.useState({ dial: '+86' }); var s = st[0], set = st[1];
    var lz = React.useState(false); var lazy = lz[0], setLazy = lz[1];
    React.useEffect(function () { var t = setTimeout(function () { setLazy(true); }, 600); return function () { clearTimeout(t); }; }, []);
    window.__state = function () { var o = JSON.parse(JSON.stringify(s)); delete o.dial; return o; };
    function put(k) { return function (v) { set(function (p) { var o = Object.assign({}, p); o[k] = v; return o; }); }; }
    function field(label, ctl, key) {
      return h('div', { className: 'apply-field' + H, key: key || label, style: { margin: '8px 0' } },
        h('div', { className: 'title' + H }, h('span', null, h('span', null, label))), ctl);
    }
    var inp = function (k, label, ph) { return field(label, h(SdInput, { value: s[k], onChange: put(k), placeholder: ph }), k); };
    var sel = function (k, label, opts, w) { return field(label, h(SdSelect, { value: s[k], onChange: put(k), options: opts, width: w }), k); };
    var ym = function (k, label, range) {
      var parts = range ? ['sy', 'sm', 'ey', 'em'] : ['y', 'm'];
      return field(label, h('div', { className: 'date-range' + H }, parts.map(function (p, i) {
        var isY = p.charAt(p.length - 1) === 'y';
        return h(SdSelect, { key: p, value: s[k + p], onChange: put(k + p), options: isY ? YEARS : MONTHS, placeholder: isY ? '年' : '月', width: 90 });
      })), k);
    };
    function block(title, groups) {
      return h('div', { className: 'apply-block' + H, key: title },
        h('div', { className: 'block-title' + H, style: { fontWeight: 'bold' } }, title),
        groups.map(function (g, i) { return h('div', { className: 'apply-fields' + H, key: i, style: { borderTop: '1px dashed #ddd' } }, g); }));
    }
    return h('div', { className: 'apply-form' + H },
      block('个人信息', [[
        inp('name', '姓名'),
        field('手机号码', h('div', null, h(SdSelect, { value: s.dial, onChange: put('dial'), options: ['+86', '+852', '+1'], width: 70 }), h(SdInput, { value: s.phone, onChange: put('phone') })), 'phone'),
        inp('email', '邮箱'), sel('gender', '性别', ['男', '女']), ym('birth', '出生年月'),
        sel('hd', '最高学历', ['大专', '本科', '硕士', '博士']), sel('fresh', '是否应届毕业生', ['应届毕业生', '往届毕业生']),
        inp('city', '所在地'), inp('ref', '推荐码')
      ]]),
      block('教育背景', [0, 1].map(function (i) {
        return [sel('school' + i, '学校', SCHOOLS), inp('major' + i, '专业'), sel('deg' + i, '学历', ['大专', '本科', '硕士', '博士']), ym('edu' + i, '就读时间', true)];
      })),
      lazy ? block('实习经历', [[inp('co', '公司名称'), inp('ti', '职位'), ym('work', '起止时间', true)]]) : null);
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
