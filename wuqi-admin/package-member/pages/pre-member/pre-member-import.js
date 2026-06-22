const { request } = require('../../../utils/request');
const config = require('../../../config/index.js');

Page({
  data: {
    fileName: '',
    filePath: '',
    uploading: false,
    uploadingText: '上传中...',
    importResult: null
  },

  // 下载模板
  async onDownloadTemplate() {
    wx.showLoading({ title: '下载模板中...' });
    try {
      const token = wx.getStorageSync('admin_token');
      const res = await new Promise((resolve, reject) => {
        wx.downloadFile({
          url: `${config.serverBase}/api/v1/pre-members/template`,
          header: { 'Authorization': `Bearer ${token}` },
          success: resolve,
          fail: reject
        });
      });

      if (res.statusCode !== 200) {
        throw new Error('下载失败');
      }

      // 复制到用户目录并指定文件名（tempFilePath 是随机 hash 名，必须复制后才能显示中文名）
      const fs = wx.getFileSystemManager();
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const timeStr = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
      const savedPath = `${wx.env.USER_DATA_PATH}/舞栖Dance会员名单_${dateStr}_${timeStr}.xlsx`;
      try {
        fs.copyFileSync(res.tempFilePath, savedPath);
      } catch (e) {
        // 如果目标文件被占用（EBUSY），换一个带毫秒的文件名重试
        const msPath = `${wx.env.USER_DATA_PATH}/舞栖Dance会员名单_${dateStr}_${timeStr}-${d.getMilliseconds()}.xlsx`;
        try {
          fs.copyFileSync(res.tempFilePath, msPath);
          openWith(msPath);
        } catch (e2) {
          console.error('复制文件失败', e2);
          wx.hideLoading();
          wx.showToast({ title: '文件处理失败，请重试', icon: 'none' });
        }
        return;
      }
      openWith(savedPath);

      function openWith(filePath) {
        wx.openDocument({
          filePath: filePath,
          fileType: 'xlsx',
          showMenu: true,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: '模板已打开，可另存为', icon: 'none' });
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '打开文件失败，请重试', icon: 'none' });
          }
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error('下载模板失败', err);
      wx.showToast({ title: '下载模板失败', icon: 'none' });
    }
  },

  // 隐私授权同意回调
  onPrivacyAgreed() {
    console.log('[Privacy] 用户同意隐私授权');
  },

  // 渠道1：从聊天文件选择（小程序唯一支持的文件选择方式）
  onChooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: (res) => {
        this.handleSelectedFile(res.tempFiles[0]);
      },
      fail: (err) => {
        console.log('文件选择取消或失败', err);
        if (err.errno === 112 || (err.errMsg && err.errMsg.indexOf('privacy') !== -1)) {
          wx.showToast({ title: '隐私授权未通过，请重试', icon: 'none' });
        }
      }
    });
  },

  // 处理选中的文件
  handleSelectedFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      wx.showToast({ title: '文件不能超过10MB', icon: 'none' });
      return;
    }
    this.setData({
      fileName: file.name,
      filePath: file.path,
      importResult: null
    });
    this.uploadFile(file.path);
  },

  // 上传文件
  async uploadFile(filePath) {
    this.setData({ uploading: true, uploadingText: '上传校验中...' });
    try {
      const token = wx.getStorageSync('admin_token');
      const uploadRes = await new Promise((resolve, reject) => {
        wx.uploadFile({
          url: `${config.serverBase}/api/v1/pre-members/import`,
          filePath: filePath,
          name: 'file',
          header: { 'Authorization': `Bearer ${token}` },
          success: resolve,
          fail: reject
        });
      });

      const resData = JSON.parse(uploadRes.data);
      if (resData.code === 200 || resData.success) {
        const result = resData.data;
        this.setData({ importResult: result, uploading: false });

        if (result.failed === 0 && result.imported_count > 0) {
          wx.showToast({ title: `成功导入${result.imported_count}条`, icon: 'success' });
        } else if (result.failed > 0) {
          wx.showToast({ title: '存在校验失败数据', icon: 'none' });
        }
      } else {
        throw new Error(resData.message || '上传失败');
      }
    } catch (err) {
      console.error('上传文件失败', err);
      this.setData({ uploading: false });
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    }
  },

  onReset() {
    this.setData({
      fileName: '',
      filePath: '',
      importResult: null
    });
  },

  onGoBack() {
    wx.navigateBack();
  }
});
