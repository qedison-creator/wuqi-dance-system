const success = (data = null, message = '操作成功') => {
  return {
    code: 200,
    message,
    data,
  };
};

const error = (code = 500, message = '操作失败', data = null) => {
  return {
    code,
    message,
    data,
  };
};

const paginate = (list = [], total = 0, page = 1, pageSize = 10) => {
  return {
    list,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.ceil(total / pageSize),
  };
};

module.exports = { success, error, paginate };
