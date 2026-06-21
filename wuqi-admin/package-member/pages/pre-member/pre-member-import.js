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

      // 直接用 tempFilePath 打开，避免复制到用户目录导致文件锁定 EBUSY
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: 'xlsx',
        showMenu: true,
        success: () => {
          wx.hideLoading();
          wx.showToast({ title: '模板已打开，可另存为', icon: 'none' });
        },
        fail: (err) => {
          console.error('直接打开失败，尝试复制后打开', err);
          // 回退方案：复制到用户目录（用时间戳唯一文件名）
          const fs = wx.getFileSystemManager();
          const timestamp = Date.now();
          const savedPath = `${wx.env.USER_DATA_PATH}/premember-template-${timestamp}.xlsx`;
          try {
            fs.copyFileSync(res.tempFilePath, savedPath);
            wx.openDocument({
              filePath: savedPath,
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
          } catch (e) {
            console.error('复制文件失败', e);
            wx.hideLoading();
            wx.showToast({ title: '文件处理失败，请重试', icon: 'none' });
          }
        }
      });
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

  // 渠道1：从聊天文件选择
  onChooseFromChat() {
    this.doChooseFile('chat');
  },

  // 渠道2：从本地文件选择
  onChooseFromLocal() {
    this.doChooseFile('local');
  },

  // 实际调用文件选择
  doChooseFile(source) {
    // source: 'chat' 聊天文件 | 'local' 本地文件
    if (source === 'local') {
      // 本地文件：wx.chooseFile（仅在 PC 端微信有效，移动端不支持）
      // 移动端本地文件需通过 wx.chooseMessageFile 的 file 类型或 wx.getFileSystemManager
      // 这里用 wx.chooseFile，PC 端可用；移动端会 fail，提示用户用聊天文件渠道
      if (typeof wx.chooseFile !== 'function') {
        wx.showModal({
          title: '提示',
          content: '当前微信版本不支持本地文件选择，请使用「从聊天选择」上传文件。',
          showCancel: false,
          confirmText: '我知道了'
        });
        return;
      }
      wx.chooseFile({
        count: 1,
        type: 'file',
        extension: ['xlsx', 'xls'],
        success: (res) => {
          this.handleSelectedFile(res.tempFiles[0]);
        },
        fail: (err) => {
          console.log('本地文件选择取消或失败', err);
          if (err.errno === 112 || (err.errMsg && err.errMsg.indexOf('privacy') !== -1)) {
            wx.showToast({ title: '隐私授权未通过，请重试', icon: 'none' });
          }
        }
      });
    } else {
      // 聊天文件：wx.chooseMessageFile
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['xlsx', 'xls'],
        success: (res) => {
          this.handleSelectedFile(res.tempFiles[0]);
        },
        fail: (err) => {
          console.log('聊天文件选择取消或失败', err);
          if (err.errno === 112 || (err.errMsg && err.errMsg.indexOf('privacy') !== -1)) {
            wx.showToast({ title: '隐私授权未通过，请重试', icon: 'none' });
          }
        }
      });
    }
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
