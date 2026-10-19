// 皮肤成功反馈组件：paper 盖章 / volt 拳入；classic 不渲染（走页面原有提示）
Component({
  properties: {
    // { visible, skin: 'paper'|'volt'|'classic', kind: 'success'|'cancel', word, seal, desc, okText }
    props: { type: Object, value: {} }
  },

  methods: {
    onOk() {
      this.triggerEvent('ok');
    },

    noop() { /* 阻止冒泡 */ }
  }
});
