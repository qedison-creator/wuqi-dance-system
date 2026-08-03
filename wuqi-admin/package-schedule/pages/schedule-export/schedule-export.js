const app = getApp();
const { request } = require('../../../utils/request');
const { fixImageUrl, cropImageSafe } = require('../../../utils/util');

// Canvas 画布尺寸（A4 @ 150DPI）
const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 1754;

Page({
  data: {
    storeId: '',
    storeName: '',
    startDate: '',
    endDate: '',
    dateRange: '',
    weekOptions: [],
    selectedWeekIndex: 0,
    weekData: null,
    backgroundUrl: '',
    generating: false,
    exportImagePath: '',
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    dpr: 2,
    // 背景图管理
    bgList: [],
    activeBgUrl: '',
    showBgManager: false,
    uploadingBg: false
  },

  onLoad(options) {
    const storeId = options.store_id || (app.globalData.currentStore && app.globalData.currentStore._id) || '';
    // URL 参数中文名 decode：跳转方用 encodeURIComponent 编码，此处必须 decode
    let storeName = '';
    if (options.store_name) {
      try {
        storeName = decodeURIComponent(options.store_name);
      } catch (e) {
        storeName = options.store_name;
      }
    }
    if (!storeName && app.globalData.currentStore && app.globalData.currentStore.name) {
      storeName = app.globalData.currentStore.name;
    }
    this.setData({ storeId, storeName });
    this.generateWeekOptions();
    this.loadBackgrounds();
  },

  // 生成可选的周列表（前后各4周）
  generateWeekOptions() {
    const today = new Date();
    const currentMonday = new Date(today);
    const dayOfWeek = today.getDay() || 7;
    currentMonday.setDate(today.getDate() - dayOfWeek + 1);

    const options = [];
    for (let i = -4; i <= 4; i++) {
      const monday = new Date(currentMonday);
      monday.setDate(currentMonday.getDate() + i * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const startDate = this.formatDate(monday);
      const endDate = this.formatDate(sunday);
      const dateRange = `${monday.getMonth() + 1}月${monday.getDate()}日-${sunday.getMonth() + 1}月${sunday.getDate()}日`;
      const isCurrent = i === 0;

      options.push({
        startDate,
        endDate,
        dateRange,
        label: isCurrent ? '本周' : (i < 0 ? `${Math.abs(i)}周前` : `${i}周后`),
        isCurrent
      });
    }

    const currentIdx = options.findIndex(o => o.isCurrent);
    this.setData({
      weekOptions: options,
      selectedWeekIndex: currentIdx >= 0 ? currentIdx : 0,
      startDate: options[currentIdx >= 0 ? currentIdx : 0].startDate,
      endDate: options[currentIdx >= 0 ? currentIdx : 0].endDate,
      dateRange: options[currentIdx >= 0 ? currentIdx : 0].dateRange
    });
  },

  formatDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  onWeekChange(e) {
    const index = Number(e.detail.value);
    const week = this.data.weekOptions[index];
    this.setData({
      selectedWeekIndex: index,
      startDate: week.startDate,
      endDate: week.endDate,
      dateRange: week.dateRange,
      exportImagePath: ''
    });
  },

  // ============ 背景图管理 ============

  async loadBackgrounds() {
    try {
      const res = await request({
        url: '/schedule-export/backgrounds',
        method: 'GET'
      });
      const list = res.data || [];
      const active = list.find(item => item.is_active);
      list.forEach(item => {
        item.background_full_url = this._fixImageUrl(item.background_url);
      });
      this.setData({
        bgList: list,
        activeBgUrl: active ? this._fixImageUrl(active.background_url) : ''
      });
    } catch (err) {
      console.error('加载背景图列表失败', err);
    }
  },

  onShowBgManager() {
    this.setData({ showBgManager: true });
    this.loadBackgrounds();
  },

  onHideBgManager() {
    this.setData({ showBgManager: false });
  },

  // 阻止冒泡
  onBgManagerStop() {},

  // 隐私授权同意回调
  onPrivacyAgreed(e) {
    console.log('[Privacy] 用户点击同意隐私授权');
    const buttonId = e.currentTarget.id || e.target.id || 'agree-btn';
    app.resolvePrivacyAuthorization(buttonId);
  },

  async onChooseBgImage() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      });
      let filePath = chooseRes.tempFiles[0].tempFilePath;

      // 裁剪：使用合法比例 3:4（最接近A4竖版），开发者工具不支持时自动跳过裁剪
      try {
        filePath = await cropImageSafe(filePath, '3:4');
      } catch (cropErr) {
        // 用户取消裁剪：中断流程
        if (cropErr.errMsg && cropErr.errMsg.indexOf('cancel') !== -1) return;
        // 其他异常：跳过裁剪继续上传（兜底）
        console.warn('裁剪异常，使用原图', cropErr);
      }

      await this.uploadBgImage(filePath);
    } catch (err) {
      if (err.errMsg && err.errMsg.indexOf('cancel') > -1) return;
      console.error('选择图片失败', err);
    }
  },

  async uploadBgImage(filePath) {
    this.setData({ uploadingBg: true });
    wx.showLoading({ title: '上传中...' });
    try {
      const token = wx.getStorageSync('admin_token') || '';
      const baseUrl = app.globalData.baseUrl;
      const uploadRes = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: baseUrl + '/upload/image?type=schedule_background',
          filePath: filePath,
          name: 'image',
          header: { 'Authorization': 'Bearer ' + token },
          success: resolve,
          fail: reject
        });
      });
      const data = JSON.parse(uploadRes.data);
      if (data.code !== 200) {
        throw new Error(data.message || '上传失败');
      }
      await request({
        url: '/schedule-export/background',
        method: 'POST',
        data: {
          background_url: data.data.path,
          background_name: data.data.filename
        }
      });
      wx.showToast({ title: '上传成功', icon: 'success' });
      this.loadBackgrounds();
    } catch (err) {
      console.error('上传背景图失败', err);
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    } finally {
      this.setData({ uploadingBg: false });
      wx.hideLoading();
    }
  },

  async onActivateBg(e) {
    const id = e.currentTarget.dataset.id;
    try {
      await request({
        url: `/schedule-export/background/${id}/activate`,
        method: 'PUT'
      });
      wx.showToast({ title: '已设为当前背景', icon: 'success' });
      this.loadBackgrounds();
    } catch (err) {
      wx.showToast({ title: '激活失败', icon: 'none' });
    }
  },

  async onDeleteBg(e) {
    const id = e.currentTarget.dataset.id;
    const res = await wx.showModal({
      title: '确认删除',
      content: '确定要删除这张背景图吗？',
      confirmColor: '#E8785A'
    });
    if (!res.confirm) return;
    try {
      await request({
        url: `/schedule-export/background/${id}`,
        method: 'DELETE'
      });
      wx.showToast({ title: '删除成功', icon: 'success' });
      this.loadBackgrounds();
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  async onGenerate() {
    if (this.data.generating) return;
    this.setData({ generating: true, exportImagePath: '' });
    wx.showLoading({ title: '正在生成课程表...' });

    try {
      // 获取周课程数据
      const res = await request({
        url: '/schedule-export/week-export',
        method: 'GET',
        data: {
          store_id: this.data.storeId,
          start_date: this.data.startDate,
          end_date: this.data.endDate
        }
      });

      const weekData = res.data;
      if (!weekData) {
        throw new Error('获取课程数据失败');
      }

      this.setData({
        weekData,
        backgroundUrl: weekData.background_url || '',
        storeName: weekData.store_name || this.data.storeName
      });

      // 开始Canvas绘制
      await this.drawSchedule();

      wx.hideLoading();
    } catch (err) {
      console.error('生成课程表失败', err);
      wx.hideLoading();
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
      this.setData({ generating: false });
    }
  },

  async drawSchedule() {
    const query = wx.createSelectorQuery();
    query.select('#scheduleCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!res[0]) {
          this.setData({ generating: false });
          wx.showToast({ title: 'Canvas初始化失败', icon: 'none' });
          return;
        }

        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) >= 2 ? 2 : 1;

        canvas.width = CANVAS_WIDTH * dpr;
        canvas.height = CANVAS_HEIGHT * dpr;
        ctx.scale(dpr, dpr);

        const data = this.data.weekData;
        const bgUrl = this.data.backgroundUrl ? this._fixImageUrl(this.data.backgroundUrl) : '';

        try {
          // 1. 绘制背景图（如有）
          if (bgUrl) {
            try {
              const bgImg = await this.loadImage(canvas, bgUrl);
              ctx.drawImage(bgImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            } catch (e) {
              // 背景加载失败，绘制渐变背景
              this.drawGradientBg(ctx);
            }
          } else {
            // 无背景图，绘制时尚渐变背景（紫蓝霓虹风格）
            this.drawGradientBg(ctx);
          }

          // 表格常量提前定义，供遮罩和表头使用
          const tableLeft = 40;
          const tableWidth = CANVAS_WIDTH - 80;

          // 2. 绘制模糊遮罩层（半透明白色毛玻璃效果，确保内容可读性的同时透出背景）
          // 左右边距与表头、课程卡片对齐：tableLeft+8 到 tableLeft+tableWidth
          const maskLeft = tableLeft + 8;
          const maskRight = tableLeft + tableWidth;
          const maskTop = 140;
          const maskBottom = CANVAS_HEIGHT - 80;
          const gradient = ctx.createLinearGradient(0, maskTop, 0, maskBottom);
          gradient.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
          gradient.addColorStop(0.15, 'rgba(255, 255, 255, 0.55)');
          gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.68)');
          gradient.addColorStop(0.85, 'rgba(255, 255, 255, 0.55)');
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0.30)');
          ctx.fillStyle = gradient;
          ctx.fillRect(maskLeft, maskTop, maskRight - maskLeft, maskBottom - maskTop);

          // 3. 绘制门店名
          ctx.fillStyle = '#1A1A1A';
          ctx.font = 'bold 48px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(this.data.storeName || '舞栖舞蹈社', CANVAS_WIDTH / 2, 200);

          // 4. 绘制日期范围
          ctx.fillStyle = '#1A1A1A';
          ctx.font = '28px sans-serif';
          ctx.fillText(this.data.dateRange, CANVAS_WIDTH / 2, 240);

          // 5. 绘制7列表头（紧凑）
          const tableTop = 270;
          const colWidth = tableWidth / 7;
          const headerHeight = 56;
          const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

          // 表头背景（使用浅橙色不透明背景，左右边距与课程卡片对齐）
          // 课程卡片整体跨度：tableLeft+8 到 tableLeft+tableWidth
          ctx.fillStyle = '#FFE5DB';
          this.roundRect(ctx, tableLeft + 8, tableTop, tableWidth - 8, headerHeight + 36, 12);
          ctx.fill();

          // 表头文字（上下间距一致，星期和日期垂直居中分布）
          ctx.textAlign = 'center';
          for (let i = 0; i < 7; i++) {
            const x = tableLeft + colWidth * i + colWidth / 2;
            ctx.fillStyle = '#1A1A1A';
            ctx.font = 'bold 24px sans-serif';
            ctx.fillText(weekdays[i], x, tableTop + 38);
            ctx.fillStyle = '#666666';
            ctx.font = '20px sans-serif';
            const day = data.days[i];
            ctx.fillText(day ? day.date : '', x, tableTop + 67);
          }

          // 6. 绘制课程卡片（头像为主的大卡片）
          // 调整表头到卡片间距和底部留白，确保A4画布内可放下5节课
          const HEADER_CARD_GAP = 12;
          const BOTTOM_MARGIN = 66;
          const courseAreaTop = tableTop + headerHeight + 36 + HEADER_CARD_GAP;
          const courseAreaHeight = CANVAS_HEIGHT - courseAreaTop - BOTTOM_MARGIN;
          const maxCoursesPerDay = Math.max(...data.days.map(d => d.courses.length), 0);
          const cardPadding = 6;

          // 预加载所有教练头像
          const avatarCache = {};
          for (const day of data.days) {
            for (const course of day.courses) {
              if (course.coach_avatar && !avatarCache[course.coach_avatar]) {
                const url = this._fixImageUrl(course.coach_avatar);
                try {
                  avatarCache[course.coach_avatar] = await this.loadImage(canvas, url);
                } catch (e) {
                  avatarCache[course.coach_avatar] = null;
                }
              }
            }
          }

          // 计算每行课程卡片高度（同行取最大文字行数，确保水平对齐）
          // 解决问题：某节课名称换行后不会入侵下一行，同行课程保持水平一致
          const rowMaxLinesArr = [];
          for (let row = 0; row < maxCoursesPerDay; row++) {
            let maxLines = 1;
            for (let col = 0; col < 7; col++) {
              const day = data.days[col];
              if (!day || !day.courses[row]) continue;
              const course = day.courses[row];
              const innerWidth = colWidth - 8;
              ctx.font = 'bold 18px sans-serif';
              const lines = this.getTextLines(ctx, course.course_name, innerWidth - 6);
              if (lines > maxLines) maxLines = lines;
            }
            rowMaxLinesArr.push(maxLines);
          }

          // 卡片内容高度计算（新布局：头像、教练名、课程名、时间、场地，上下边距一致）
          // 所有文字统一18px，基础高度：上下padding各16 + 头像100 + 间距10 + 教练名22 + 间距10 + 课程名单行22 + 间距10 + 时间22 + 间距8 + 教室22
          const CARD_TOP_PADDING = 16;
          const CARD_BOTTOM_PADDING = 16;
          const AVATAR_SIZE = 100;
          const GAP_M = 10;
          const GAP_S = 8;
          const TEXT_SIZE = 18;
          const COACH_LINE_H = 22;
          const COURSE_LINE_H = 22;
          const TIME_LINE_H = 22;
          const CLASSROOM_LINE_H = 22;

          const baseCardHeight = CARD_TOP_PADDING + AVATAR_SIZE + GAP_M + COACH_LINE_H + GAP_M + COURSE_LINE_H + GAP_M + TIME_LINE_H + GAP_S + CLASSROOM_LINE_H + CARD_BOTTOM_PADDING;
          let rowHeights = rowMaxLinesArr.map(maxLines =>
            Math.min(baseCardHeight + (maxLines - 1) * COURSE_LINE_H, 360)
          );

          // 总高度超出可用区域时按比例缩放
          const totalCardHeight = rowHeights.reduce((sum, h) => sum + h + cardPadding, 0);
          if (totalCardHeight > courseAreaHeight && totalCardHeight > 0) {
            const scale = courseAreaHeight / totalCardHeight;
            rowHeights = rowHeights.map(h => Math.floor(h * scale));
          }

          // 按行绘制（同行所有列卡片高度一致，保证水平对齐）
          let currentY = courseAreaTop;
          for (let row = 0; row < maxCoursesPerDay; row++) {
            const cardHeight = rowHeights[row];
            const maxLines = rowMaxLinesArr[row];

            for (let col = 0; col < 7; col++) {
              const day = data.days[col];
              if (!day || !day.courses[row]) continue;

              const course = day.courses[row];
              const colX = tableLeft + colWidth * col;
              const centerX = colX + colWidth / 2;
              const innerWidth = colWidth - 8;

              // 卡片背景（半透明玻璃感）
              ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
              this.roundRect(ctx, colX + 8, currentY, innerWidth, cardHeight - cardPadding, 12);
              ctx.fill();

              // 计算本节课内容高度（根据是否有教室、课程名行数）
              const hasClassroom = !!course.classroom;
              const courseNameHeight = maxLines * COURSE_LINE_H;
              const contentHeight = AVATAR_SIZE + GAP_M + COACH_LINE_H + GAP_M + courseNameHeight + GAP_M + TIME_LINE_H + (hasClassroom ? GAP_S + CLASSROOM_LINE_H : 0);
              const contentTop = currentY + Math.max(0, (cardHeight - cardPadding - contentHeight) / 2);

              // 教练头像（大圆形，主角）
              const avatarY = contentTop;
              if (avatarCache[course.coach_avatar]) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(centerX, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatarCache[course.coach_avatar], centerX - AVATAR_SIZE / 2, avatarY, AVATAR_SIZE, AVATAR_SIZE);
                ctx.restore();
              } else {
                ctx.fillStyle = '#EEEEEE';
                ctx.beginPath();
                ctx.arc(centerX, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
                ctx.fill();
              }

              // 教练姓名
              const coachBaseline = contentTop + AVATAR_SIZE + GAP_M + COACH_LINE_H * 0.75;
              ctx.fillStyle = '#1A1A1A';
              ctx.font = '18px sans-serif';
              ctx.fillText(course.coach_name, centerX, coachBaseline);

              // 课程名
              const courseNameBaseline = contentTop + AVATAR_SIZE + GAP_M + COACH_LINE_H + GAP_M + COURSE_LINE_H * 0.75;
              ctx.fillStyle = '#1A1A1A';
              ctx.font = 'bold 18px sans-serif';
              this.drawWrappedText(ctx, course.course_name, centerX, courseNameBaseline, innerWidth - 6, COURSE_LINE_H);

              // 上课时间
              const timeBaseline = contentTop + AVATAR_SIZE + GAP_M + COACH_LINE_H + GAP_M + courseNameHeight + GAP_M + TIME_LINE_H * 0.75;
              ctx.fillStyle = '#E8785A';
              ctx.font = 'bold 18px sans-serif';
              ctx.fillText(`${course.start_time}-${course.end_time}`, centerX, timeBaseline);

              // 上课场地（如有）
              if (hasClassroom) {
                const classroomBaseline = timeBaseline + TIME_LINE_H * 0.25 + GAP_S + CLASSROOM_LINE_H * 0.75;
                ctx.fillStyle = '#1A1A1A';
                ctx.font = '18px sans-serif';
                ctx.fillText(course.classroom, centerX, classroomBaseline);
              }
            }

            currentY += cardHeight + cardPadding;
          }

          // 7. 底部品牌信息
          ctx.fillStyle = '#999999';
          ctx.font = '20px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('舞栖舞蹈社 · 课程表', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 30);

          // 9. 导出图片
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            destWidth: CANVAS_WIDTH * 2,
            destHeight: CANVAS_HEIGHT * 2,
            fileType: 'jpg',
            quality: 0.92,
            success: (res) => {
              this._saveExportImage(res.tempFilePath);
            },
            fail: (err) => {
              console.error('导出图片失败', err);
              this.setData({ generating: false });
              wx.showToast({ title: '导出失败', icon: 'none' });
            }
          });
        } catch (err) {
          console.error('绘制失败', err);
          this.setData({ generating: false });
          wx.showToast({ title: '绘制失败', icon: 'none' });
        }
      });
  },

  // 绘制时尚渐变背景（紫蓝霓虹风格，A4竖版）
  drawGradientBg(ctx) {
    // 主渐变：左上深紫 → 右下深蓝
    const grad = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    grad.addColorStop(0, '#1a0b2e');
    grad.addColorStop(0.3, '#2d1b4e');
    grad.addColorStop(0.6, '#1e3a5f');
    grad.addColorStop(1, '#0f1929');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 装饰光晕1：右上紫色光斑
    const glow1 = ctx.createRadialGradient(
      CANVAS_WIDTH * 0.85, 200, 0,
      CANVAS_WIDTH * 0.85, 200, 400
    );
    glow1.addColorStop(0, 'rgba(180, 80, 220, 0.35)');
    glow1.addColorStop(0.5, 'rgba(180, 80, 220, 0.12)');
    glow1.addColorStop(1, 'rgba(180, 80, 220, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 装饰光晕2：左下青蓝色光斑
    const glow2 = ctx.createRadialGradient(
      CANVAS_WIDTH * 0.15, CANVAS_HEIGHT * 0.85, 0,
      CANVAS_WIDTH * 0.15, CANVAS_HEIGHT * 0.85, 450
    );
    glow2.addColorStop(0, 'rgba(80, 200, 220, 0.30)');
    glow2.addColorStop(0.5, 'rgba(80, 200, 220, 0.10)');
    glow2.addColorStop(1, 'rgba(80, 200, 220, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 装饰光晕3：中间粉色光斑
    const glow3 = ctx.createRadialGradient(
      CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.45, 0,
      CANVAS_WIDTH * 0.5, CANVAS_HEIGHT * 0.45, 500
    );
    glow3.addColorStop(0, 'rgba(232, 120, 90, 0.18)');
    glow3.addColorStop(0.5, 'rgba(232, 120, 90, 0.06)');
    glow3.addColorStop(1, 'rgba(232, 120, 90, 0)');
    ctx.fillStyle = glow3;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  },

  // 计算文字在指定宽度下需要的行数（最多2行）
  getTextLines(ctx, text, maxWidth) {
    if (!text) return 1;
    const chars = text.split('');
    let line = '';
    let lineCount = 1;
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line.length > 0) {
        line = chars[i];
        lineCount++;
        if (lineCount >= 2) break;
      } else {
        line = testLine;
      }
    }
    return lineCount;
  },

  drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    if (!text) return;
    const chars = text.split('');
    let line = '';
    let lineCount = 0;
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line.length > 0) {
        ctx.fillText(line, x, y + lineCount * lineHeight);
        line = chars[i];
        lineCount++;
        if (lineCount >= 2) break;
      } else {
        line = testLine;
      }
    }
    if (lineCount < 2) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
    }
  },

  loadImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  },

  onSaveImage() {
    if (!this.data.exportImagePath) {
      wx.showToast({ title: '请先生成课程表', icon: 'none' });
      return;
    }
    console.log('[保存图片] 开始保存，路径:', this.data.exportImagePath);

    // 先检查相册写入权限
    wx.getSetting({
      success: (settingRes) => {
        const hasPermission = settingRes.authSetting['scope.writePhotosAlbum'];
        if (hasPermission === false) {
          // 之前拒绝过，引导去设置
          wx.showModal({
            title: '提示',
            content: '需要相册权限才能保存图片，请在设置中开启',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: (openRes) => {
                    if (openRes.authSetting['scope.writePhotosAlbum']) {
                      this._doSaveImage();
                    }
                  }
                });
              }
            }
          });
          return;
        }
        // 未授权或已授权，直接尝试保存
        this._doSaveImage();
      },
      fail: () => {
        this._doSaveImage();
      }
    });
  },

  _doSaveImage() {
    wx.saveImageToPhotosAlbum({
      filePath: this.data.exportImagePath,
      success: () => {
        console.log('[保存图片] 成功');
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (err) => {
        console.error('[保存图片] 失败:', JSON.stringify(err));
        const errMsg = err.errMsg || '';
        const errno = err.errno;

        // errno:112 隐私协议未声明 writePhotosAlbum 权限
        if (errno === 112 || errMsg.indexOf('privacy') > -1) {
          // 降级方案：通过预览图片让用户长按保存
          wx.showModal({
            title: '保存方式',
            content: '由于隐私协议限制，请长按预览图片选择"保存到手机"来保存课程表',
            confirmText: '预览图片',
            success: (res) => {
              if (res.confirm) {
                wx.previewImage({
                  urls: [this.data.exportImagePath],
                  current: this.data.exportImagePath
                });
              }
            }
          });
          return;
        }

        // 权限拒绝
        if (errMsg.indexOf('auth deny') > -1 || errMsg.indexOf('authorize') > -1) {
          wx.showModal({
            title: '提示',
            content: '需要相册权限才能保存图片，请在设置中开启',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting();
            }
          });
          return;
        }

        wx.showToast({ title: '保存失败，请长按预览图保存', icon: 'none' });
      }
    });
  },

  onPreviewImage() {
    if (!this.data.exportImagePath) return;
    wx.previewImage({
      urls: [this.data.exportImagePath]
    });
  },

  // 将Canvas导出的临时文件保存为本地持久化文件
  // 开发者工具中临时路径以 http://tmp/ 开头，渲染到 <image> 会触发 HTTP 协议警告
  // 保存后路径变为 wxfile:// 协议，兼容开发者工具和真机
  _saveExportImage(tempFilePath) {
    const fs = wx.getFileSystemManager();
    // 清理上一次保存的本地文件，避免存储空间膨胀
    if (this._savedExportPath) {
      try { fs.unlinkSync(this._savedExportPath); } catch (e) { /* 忽略 */ }
    }
    fs.saveFile({
      tempFilePath,
      success: (saveRes) => {
        this.setData({
          exportImagePath: saveRes.savedFilePath,
          generating: false
        });
        this._savedExportPath = saveRes.savedFilePath;
        wx.showToast({ title: '生成成功', icon: 'success' });
      },
      fail: () => {
        // 保存失败：回退到临时路径（真机上临时路径为 wxfile:// 不会报警告）
        this.setData({
          exportImagePath: tempFilePath,
          generating: false
        });
        wx.showToast({ title: '生成成功', icon: 'success' });
      }
    });
  },

  onUnload() {
    // 页面卸载时清理本地保存的导出图片
    if (this._savedExportPath) {
      try { wx.getFileSystemManager().unlinkSync(this._savedExportPath); } catch (e) { /* 忽略 */ }
    }
  },

  _fixImageUrl(url) {
    return fixImageUrl(url);
  }
});
