const uCharts = require('../../utils/u-charts.js').default;

Component({
  properties: {
    chartId: { type: String, value: 'dcchart' },
    // ucharts 图表类型：column（柱状）/ bar（横向条形）/ line（折线）
    type: { type: String, value: 'column' },
    categories: { type: Array, value: [] },
    series: { type: Array, value: [] },
    height: { type: Number, value: 320 }, // rpx
    // 轴标题（仅标注一个单位，不逐刻度重复）：如 Y 轴“课时”、X 轴“日期”
    yAxisTitle: { type: String, value: '' },
    xAxisTitle: { type: String, value: '' },
  },

  observers: {
    'categories, series': function () {
      this.render();
    },
  },

  lifetimes: {
    ready() { this.render(); },
    detached() {
      this._stopMarquee();
      if (this._chart) { try { this._chart.stop && this._chart.stop(); } catch (e) { /* ignore */ } }
      this._chart = null;
    },
  },

  methods: {
    render() {
      this._stopMarquee();
      const { chartId, type, categories, series, yAxisTitle, xAxisTitle } = this.data;
      if (!categories || !categories.length || !series || !series.length) return;
      const query = this.createSelectorQuery();
      query.select('#' + chartId).fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        // 物理像素比：优先新版 API（getSystemInfoSync 已废弃）
        let dpr = 2;
        try {
          const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          dpr = win.pixelRatio || 2;
        } catch (e) { /* 用默认 2 */ }

        // u-charts 约定：width/height 传物理像素（CSS 尺寸 × dpr），坐标即铺满整个画布背板
        const cssW = res[0].width;
        const cssH = res[0].height;
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;

        if (this._chart) { try { this._chart.stop && this._chart.stop(); } catch (e) { /* ignore */ } }
        const isBar = type === 'bar';

        // 条形图（横向）：数值轴在 X，最长条形若顶满右边界，末端数值标签会被截断在画布外。
        // 因此把 X 轴最大值放大到 1.15 倍并向上取整（4 的倍数保证刻度为整数），
        // 让最长条形只占约 85% 宽度，右侧预留数值标签空间。
        let xMax;
        if (isBar) {
          const vals = [];
          series.forEach(s => (s.data || []).forEach(v => { if (typeof v === 'number') vals.push(v); }));
          if (vals.length) {
            const maxVal = Math.max.apply(null, vals);
            // X 轴最大值取 4 的倍数（splitNumber=4 时每段均为整数刻度）
            xMax = Math.max(4, Math.ceil((maxVal * 1.15) / 4) * 4);
          }
        }
        // 无数据时的兜底，避免 X 轴刻度为 NaN
        if (isBar && !xMax) xMax = 4;

        // 条形图左侧名称列：名义最大宽度取“最长名称宽”与“图表宽 36%”的较小值（rpx→px 单位）
        // 超出的长名称会进入横向滚动显示，避免名称列过宽挤压条形。
        let labelCap = null;
        if (isBar && categories.length) {
          try {
            const fontPx = 12 * dpr;
            ctx.setFontSize(fontPx);
            let maxW = 0;
            categories.forEach(n => {
              const w = (ctx.measureText(String(n)).width || 0) / dpr;
              if (w > maxW) maxW = w;
            });
            if (maxW > 0) {
              const capCss = Math.min(maxW, cssW * 0.36, 150);
              labelCap = capCss;
              this._needScroll = maxW > capCss;
            }
          } catch (e) { /* 测量失败则不启用滚动 */ }
        }

        const yLabelCap = labelCap;

        this._chart = new uCharts({
          type,
          context: ctx,
          width: cssW * dpr,
          height: cssH * dpr,
          pixelRatio: dpr,
          categories,
          series,
          animation: true,
          background: 'transparent',
          // 上下左右留白：底部多留空间给 x 轴标签，避免柱子/标签挤压卡片边框
          padding: [12, 12, 10, 10],
          legend: { show: false, fontSize: 11 },
          // 条形图在条形末端显示数值
          dataLabel: isBar ? true : false,
          xAxis: {
            disableGrid: false,
            fontSize: 12,
            // 条形图 X 轴按 4 等分（xMax 为 4 的倍数），保证刻度显示为整数，避免出现小数（如 26.40）
            splitNumber: isBar ? 4 : 5,
            min: isBar ? 0 : undefined,
            max: isBar ? xMax : undefined,
            // 柱状图 X 轴只显示“日”（2 个字符），无需旋转即可放下
            itemCount: categories.length,
            rotateLabel: false,
            // X 轴单位标题（仅标注一个，绘制在横轴末端下方）
            title: xAxisTitle || '',
            titleFontSize: 11,
            titleFontColor: '#999999',
            titleOffsetX: 2,
            titleOffsetY: -6,
            marginTop: 2,
            lineHeight: 9,
          },
          yAxis: {
            gridType: 'dash',
            splitNumber: 4,
            fontSize: 12,
            // Y 轴单位标题（显示在数值轴顶部），仅当配置了标题文本时启用
            showTitle: !!yAxisTitle,
            title: yAxisTitle || '',
            titleFontSize: 11,
            titleFontColor: '#999999',
            titleOffsetX: 0,
            titleOffsetY: 2,
            // 柱状图数值轴强制从 0 开始：u-charts 默认从数据最小值起画，
            // 导致柱子底部悬空、比例失真（“击穿”观感）；条形图 Y 轴是类别名不受影响
            min: isBar ? undefined : 0,
            // 仅柱状图对数值轴做整数化；条形图 Y 轴是类别名（课程/教练名），
            // 一旦套用整数化 formatter 会把字符串转成 NaN
            formatter: isBar ? undefined : (val => (val % 1 === 0 ? String(val) : String(Math.round(val)))),
            // 条形图名称列宽度上限（px）：超长名称进入横向滚动显示
            maxLabelWidth: isBar ? yLabelCap : undefined,
          },
          extra: this.buildExtra(type),
        });
        this._maybeStartMarquee();
      });
    },

    // 有条形状左侧名称超宽时，启动横向滚动重绘
    _maybeStartMarquee() {
      if (!this._needScroll || !this._chart) return;
      try {
        this._chart.opts.animation = false;
        this._chart.updateData({ scrollLabel: 0 });
        this._scrollT = 0;
        this._marqueeTimer = setInterval(() => {
          this._scrollT += 1.5;
          try { this._chart.updateData({ scrollLabel: this._scrollT }); } catch (e) { /* ignore */ }
        }, 16);
      } catch (e) { /* 忽略 */ }
    },

    _stopMarquee() {
      if (this._marqueeTimer) { clearInterval(this._marqueeTimer); this._marqueeTimer = null; }
    },

    // 按类型提供必需的 extra 配置（u-charts 内部会读取，缺省会崩：
    // 如 bar 类型的 fixBarData 无条件读 extra.bar.seriesGap）
    buildExtra(type) {
      if (type === 'bar') {
        return { bar: { seriesGap: 2, categoryGap: 3, barBorderRadius: [0, 6, 6, 0] } };
      }
      return { column: { width: 18, activeBgColor: '#000000', activeBgOpacity: 0.06 } };
    },
  },
});
