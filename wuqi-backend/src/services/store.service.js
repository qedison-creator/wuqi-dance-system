const Store = require('../models/Store');

// 获取所有启用的门店
exports.getStores = async () => {
  const stores = await Store.find({ status: 'active' }).sort({ created_at: 1 });
  return stores;
};

// 获取门店详情
exports.getStoreById = async (id) => {
  const store = await Store.findById(id);
  if (!store) {
    throw new Error('门店不存在');
  }
  return store;
};

// 编辑门店(仅超管)
exports.updateStore = async (id, data) => {
  const store = await Store.findById(id);
  if (!store) {
    throw new Error('门店不存在');
  }

  const allowedFields = ['name', 'address', 'phone', 'description', 'images', 'business_hours', 'status', 'location', 'nav_name'];
  for (const key of Object.keys(data)) {
    if (allowedFields.includes(key)) {
      store[key] = data[key];
    }
  }

  await store.save();
  return store;
};

// 初始化默认门店
exports.initDefaultStores = async () => {
  const count = await Store.countDocuments();
  if (count > 0) return;

  const defaultStores = [
    {
      name: '福永店',
      address: '深圳市宝安区福永街道',
      phone: '0755-12345678',
      description: '舞栖舞蹈社福永旗舰店',
      business_hours: { start: '09:00', end: '22:00' },
      status: 'active',
      location: {
        latitude: 22.673711370073942,
        longitude: 113.80758091807364
      }
    },
    {
      name: '固戍店',
      address: '深圳市宝安区固戍地铁站附近',
      phone: '0755-87654321',
      description: '舞栖舞蹈社固戍分店',
      business_hours: { start: '09:00', end: '22:00' },
      status: 'active',
      location: {
        latitude: 22.60050244431253,
        longitude: 113.8477899134159
      }
    },
  ];

  await Store.insertMany(defaultStores);
  return defaultStores;
};

// 获取门店列表(管理端)
exports.getStoreList = async (query) => {
  const { status, keyword, page = 1, pageSize = 20 } = query;
  const filter = {};
  if (status) filter.status = status;
  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: 'i' } },
      { address: { $regex: keyword, $options: 'i' } },
    ];
  }

  const list = await Store.find(filter)
    .sort({ created_at: -1 })
    .skip((page - 1) * pageSize)
    .limit(Number(pageSize));

  const total = await Store.countDocuments(filter);
  return { list, total, page: Number(page), pageSize: Number(pageSize) };
};

// 创建门店
exports.createStore = async (data) => {
  if (!data.name) {
    throw new Error('门店名称不能为空');
  }
  const store = await Store.create(data);
  return store;
};

// 删除门店
exports.deleteStore = async (id) => {
  const store = await Store.findById(id);
  if (!store) {
    throw new Error('门店不存在');
  }
  await Store.findByIdAndDelete(id);
  return { success: true };
};