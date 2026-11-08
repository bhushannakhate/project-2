export function createCustomerService(customerModel) {
  return {
    list(limit) {
      return customerModel.list(limit);
    },
    create(customer) {
      return customerModel.create(customer);
    },
    update(id, customer) {
      return customerModel.update(id, customer);
    },
    delete(id) {
      return customerModel.delete(id);
    },
  };
}
