"""打包扩展：dist/resume-autofill-tool-v<版本>.zip

只打运行必需的文件（manifest / background / content / options / shared / icons / README），
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

INCLUDE_DIRS = ["background", "content", "options", "shared", "icons"]
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

size = out.stat().st_size
print(f"包: {out}")
print(f"版本: {version}   大小: {size/1024:.1f} KB   文件数: {len(files)}")
