// 北森 Phoenix 公开组件（@beisen-phoenix 3.3.55）打成浏览器包，供 pages/beisen.html 组合成北森网申表单
import Select from '@beisen-phoenix/select';
import SelectList from '@beisen-phoenix/select-list';
import Layer from '@beisen-phoenix/unmodeled-layer';
import DatePicker, { MonthPicker, DateRangePicker } from '@beisen-phoenix/date-picker';
import Radio from '@beisen-phoenix/radio';
import Input from '@beisen-phoenix/input';
window.Phoenix = { Select, SelectList, Layer, DatePicker, MonthPicker, DateRangePicker, Radio, Input };
