FROM onlyoffice/documentserver:8.3.1

# Dream Weave renders documents as artifact previews rather than an editable
# canvas. The stock light theme draws a gray page boundary on the rendering
# canvas. Its color is the `canvas-page-border` token in the self-hosted
# frontend bundle; set it to white for every supported document renderer.
RUN sed -i 's/jDb:"#BBBEC2"/jDb:"#FFFFFF"/g' \
      /var/www/onlyoffice/documentserver/sdkjs/word/sdk-all-min.js \
      /var/www/onlyoffice/documentserver/sdkjs/cell/sdk-all-min.js \
      /var/www/onlyoffice/documentserver/sdkjs/slide/sdk-all-min.js \
 && sed -i 's/Bg:"#BBBEC2"/Bg:"#FFFFFF"/g' \
      /var/www/onlyoffice/documentserver/sdkjs/pdf/src/engine/viewer.js

# Keep the no-controls policy in every ONLYOFFICE embedded frontend rather
# than injecting it into the host application's iframe at runtime.
COPY dream-weave-preview.css /tmp/dream-weave-document-preview.css
COPY dream-weave-spreadsheet-preview.css /tmp/dream-weave-spreadsheet-preview.css
COPY dream-weave-presentation-preview.css /tmp/dream-weave-presentation-preview.css
RUN cat /tmp/dream-weave-document-preview.css >> /var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/embed/resources/css/app-all.css \
 && cat /tmp/dream-weave-spreadsheet-preview.css >> /var/www/onlyoffice/documentserver/web-apps/apps/spreadsheeteditor/embed/resources/css/app-all.css \
 && cat /tmp/dream-weave-presentation-preview.css >> /var/www/onlyoffice/documentserver/web-apps/apps/presentationeditor/embed/resources/css/app-all.css

# The embedded loader is rendered before the application stylesheet is fetched.
# Replace it inline, so the first visible frame is a Dream Weave loader rather
# than ONLYOFFICE branding.
RUN sed -i 's|</head>|<style id="dream-weave-preview-loader">#loading-mask{background:#fff!important}#loading-mask .loader-page,#loading-mask .loader-page-text{display:none!important}#loading-mask:before{content:"";box-sizing:border-box;position:absolute;top:calc(50% - 24px);left:calc(50% - 14px);width:28px;height:28px;border:2px solid rgb(120 131 153 / .25);border-top-color:rgb(120 131 153 / .75);border-radius:50%;animation:dw-preview-spin .9s linear infinite}#loading-mask:after{content:"正在加载预览";position:absolute;top:calc(50% + 18px);left:0;width:100%;color:#788399;font:12px/18px ui-sans-serif;text-align:center}@keyframes dw-preview-spin{to{transform:rotate(360deg)}}</style></head>|' \
      /var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/embed/index_loader.html \
      /var/www/onlyoffice/documentserver/web-apps/apps/documenteditor/embed/index.html \
      /var/www/onlyoffice/documentserver/web-apps/apps/spreadsheeteditor/embed/index_loader.html \
      /var/www/onlyoffice/documentserver/web-apps/apps/spreadsheeteditor/embed/index.html \
      /var/www/onlyoffice/documentserver/web-apps/apps/presentationeditor/embed/index_loader.html \
      /var/www/onlyoffice/documentserver/web-apps/apps/presentationeditor/embed/index.html
