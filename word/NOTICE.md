# Word 能力来源

本插件包含用户本地 Legalwork 工程的四类代码，执行时只调用 Node 标准库。建议使用 Legalwork 对应的 Node 24.14.1 或兼容版本。

* `vendor/document-export.mjs` 源自 `apps/legalwork/web/document-export.mjs`。提取其中的 DOCX、表格、段落、样式和 ZIP 封装，移除了专用于 PDF/HTML 打印的函数及浏览器渲染依赖。
* `vendor/docx.mjs` 与 `vendor/xml.mjs` 源自同一工程 `apps/contract-workbench/lib/`。仅调整导入相对路径。生成可原生接受、拒绝的 Word 修订及理由批注。
* `vendor/revise.mjs` 与 `vendor/zip.mjs` 源自同一工程 `experiments/docx-generate/lib/`。用于定位段落、构造 OOXML 和保留 Word 包内的其他部件。
* Legalwork 声明采用 AGPL-3.0-or-later，其随附许可证收录为 `vendor/APP-AGPL-3.0.txt`。

`word-tools.mjs` 完成本插件的案件绑定、引文核验、法务语言检查、报告组织和副本输出。
