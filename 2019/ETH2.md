# ETH2

## 相关属于概念
https://www.mytoken.io/news/106957.html


## Beacon node
### 功能
- 读取 eth1 链上存款合约的事件日志，将符合条件的账号缓存（每个 node 默认应该包含所有账号）
- 随机选取Validator 加入委员会

### API
https://app.swaggerhub.com/apis/spble/beacon_node_api_for_validator/0.3.0#/MinimalSet/get_node_genesis_time



## Validator client
### 功能
- 一个账号对应一个 client 节点
- 节点可以提议新区块
- 节点可以验证其它 client 提议的区块
- 每 12 秒执行一次 slot