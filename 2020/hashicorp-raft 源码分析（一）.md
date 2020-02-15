# hashicorp/raft 源码分析（一）

## 背景
最近接手个项目有要求多机房（6 个机房） mysql数据一致的场景，其实这种场景本来可以使用阿里开源的 [canal](https://github.com/alibaba/canal)+[Otter](https://github.com/alibaba/otter) 方案或者切到 TiDB解决，奈何 DBA 和运维都不愿意配合部署搭建觉得成本太高，只是建议我们自己基于应用 API 做同步。但是作为一个工程师怎么能止步于此，所以就想 TiDB 是基于 raft 协议做数据同步，我要不也基于 raft 之上做个同步，就找到了[hashicorp/raft](https://github.com/hashicorp/raft) 这个开源库，著名的[consul](https://github.com/hashicorp/consul)就是基于这个库实现的同步，所以就基于它做了一套方案，基本已经实现完成了，在这过程中也对 raft 协议和[hashicorp/raft](https://github.com/hashicorp/raft)的实现有更深的了解，而且目前最新的版本是 1.4.X，因为官方仓库上没有详细的说明文档，而网上的一些文章也是基于之前的版本介绍，所以这阶段自己也花了些时间摸索，所以也拿出来分享下。


## 创建 Raft 节点
第一步当然是要创建节点，先上代码

```go

func newRaftTransport(addr string) (*raft.NetworkTransport, error) {
	address, err := net.ResolveTCPAddr("tcp", addr)
	if err != nil {
		return nil, err
	}
	transport, err := raft.NewTCPTransport(address.String(), address, 3, 10*time.Second, os.Stderr)
	if err != nil {
		return nil, err
	}
	return transport, nil
}

	config := raft.DefaultConfig()
	config.LocalID = "Node1"
	
	snapshotStore, err := raft.NewFileSnapshotStore("./", 1, os.Stderr)
	if err != nil {
		// ...
	}

	logStore, err := raftboltdb.NewBoltStore(filepath.Join("./",
		"raft-log.bolt"))
	if err != nil {
		// ...
	}
	stableStore, err := raftboltdb.NewBoltStore(filepath.Join(r"./"
		"raft-stable.bolt"))
	if err != nil {
		// ...
	}

	transport, err := newRaftTransport("127.0.0.1:7000")
	if err != nil {
    // ...
	}
	
	var configuration raft.Configuration
	configuration.Servers = append(configuration.Servers, raft.Server{
		Suffrage: raft.Voter,
		ID:       "Node1",
		Address:  transport.LocalAddr(),
	})

	// 初始化集群，这里只有第一次调用会成功，之后的调用因为节点目录已经创建，就会调用失败，除非你把节点目录删除
	err = raft.BootstrapCluster(config, logStore, stableStore, snapshotStore, transport, configuration)
	if err == raft.ErrCantBootstrap {
		// ...
	}
	
  fsm := &MockFSM{}
	r, err := raft.NewRaft(config, fsm, logStore, stableStore, snapshotStore, transport)
	if err != nil {
    // ...
	}
	
	
	
// Apply 日志条目commit后
func (fsm *MockFSM) Apply(thelog *raft.Log) interface{} {
	
	return nil
}

// Snapshot 一定时间后会自动触发，可配置
func (fsm *MockFSM) Snapshot() (raft.FSMSnapshot, error) {
return nil,nil

}

// Restore 节点重启时会调用
func (fsm *MockFSM) Restore(serialized io.ReadCloser) error {
	return nil
}



// MockSnapshot ...
type MockSnapshot struct {
}

// Persist 通过 sink保存数据，sink 就是之前定义的 snapshotStore
func (s *MockSnapshot) Persist(sink raft.SnapshotSink) error {
		return nil
}

// Release Persist 方法执行完会调用
func (s *MockSnapshot) Release() {
}

	
```

以上就是创建一个 raft 节点的过程，其中因为底层存储是基于 `boltdb`，所以还需要引入[raft-boltdb](github.com/hashicorp/raft-boltdb)，对于自身的业务逻辑其实只要实现`FSM`的三个方法就可以了


## 参考资料
  - [使用hashicorp/raft](https://www.jianshu.com/p/273ad75a36ac)
  - [基于hashicorp/raft的分布式一致性实战教学](https://cloud.tencent.com/developer/article/1211094)
