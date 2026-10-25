// 皮肤化状态拦截组件：classic 柔和卡片 / paper 盖章 / volt 拳入
Component({
  properties: {
    // { visible, skin: 'classic'|'paper'|'volt', kind, title, desc, okText }
    props: { type: Object, value: {} }
  },

  methods: {
    onOk() {
      this.triggerEvent('ok');
    },

    noop() { /* 阻止冒泡 */ }
  }
});
