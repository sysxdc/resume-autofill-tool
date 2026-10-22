"""打包扩展：dist/resume-autofill-tool-v<版本>.zip

只打运行必需的文件（manifest / background / content / options / popup / shared / lib / demo / icons），
测试、脚本、node_modules、临时目录一律不进包——否则装上去的扩展会带着一堆无用文件。
"""
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
man = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
version = man["version"]

out_dir = root / "dist"
out_dir.mkdir(exist_ok=True)
out = out_dir / f"resume-autofill-tool-v{version}.zip"
if out.exists():
    out.unlink()

# popup：工具栏弹窗（manifest.action.default_popup）；lib：pdf.js / mammoth（简历导入）；
# demo：web_accessible_resources 里声明的演示页。少任何一个，装上去都有功能是坏的。
INCLUDE_DIRS = ["background", "content", "options", "popup", "shared", "lib", "demo", "icons"]
INCLUDE_FILES = ["manifest.json"]   # README 是开发文档（60KB+），不进包
SKIP_SUFFIX = {".map", ".py", ".log", ".md.bak"}

files = []
for d in INCLUDE_DIRS:
    base = root / d
    if not base.exists():
        continue
    for f in sorted(base.rglob("*")):
        if f.is_file() and f.suffix not in SKIP_SUFFIX:
            files.append(f)
for name in INCLUDE_FILES:
    p = root / name
    if p.exists():
        files.append(p)

if not (root / "manifest.json").exists():
    sys.exit("manifest.json 不在仓库根目录")

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files:
        arc = str(f.relative_to(root)).replace("\\", "/")
        z.write(f, arc)

# 自检：包能不能被当扩展读，manifest 是否在根
with zipfile.ZipFile(out) as z:
    names = z.namelist()
    assert "manifest.json" in names, "manifest.json 必须在压缩包根目录"
    inner = json.loads(z.read("manifest.json").decode("utf-8"))
    assert inner["version"] == version
    # manifest 引用到的每个文件都必须在包里（弹窗 / 选项页 / 后台 / 内容脚本 / 图标）
    refs = []
    refs.append(inner.get("background", {}).get("service_worker"))
    refs.append(inner.get("options_page"))
    refs.append(inner.get("action", {}).get("default_popup"))
    refs += list(inner.get("action", {}).get("default_icon", {}).values())
    refs += list(inner.get("icons", {}).values())
    for cs in inner.get("content_scripts", []):
        refs += cs.get("js", []) + cs.get("css", [])
    missing = sorted({r for r in refs if r and r not in names})
    assert not missing, f"manifest 引用的文件不在包里: {missing}"
    # 页面里 <script src> / <link href> 引用的本地文件
    import re
    for n in names:
        if not n.endswith(".html"):
            continue
        html = z.read(n).decode("utf-8", "ignore")
        base = n.rsplit("/", 1)[0] if "/" in n else ""
        for ref in re.findall(r'(?:src|href)="([^"#?:]+\.(?:js|css))"', html):
            path = pathlib.PurePosixPath(base, ref)
            parts = []
            for seg in path.parts:
                if seg == "..":
                    if parts:
                        parts.pop()
                elif seg != ".":
                    parts.append(seg)
            target = "/".join(parts)
            assert target in names, f"{n} 引用的 {ref} 不在包里"

size = out.stat().st_size
print(f"包: {out}")
print(f"版本: {version}   大小: {size/1024:.1f} KB   文件数: {len(files)}")
