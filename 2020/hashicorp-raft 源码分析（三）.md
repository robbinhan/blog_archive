# hashicorp/raft 源码分析（三）

### NewRaft

```go

func NewRaft(conf *Config, fsm FSM, logs LogStore, stable StableStore, snaps SnapshotStore, trans Transport) (*Raft, error) {
	// 校验配置
	if err := ValidateConfig(conf); err != nil {
		return nil, err
	}

	// ...跳过一些不重要的代码
	
	// 从stablestore读取CurrentTerm
	currentTerm, err := stable.GetUint64(keyCurrentTerm)
	if err != nil && err.Error() != "not found" {
		return nil, fmt.Errorf("failed to load current term: %v", err)
	}

	// 从 logstore 读取最新的 log 的key
	lastIndex, err := logs.LastIndex()
	if err != nil {
		return nil, fmt.Errorf("failed to find last log: %v", err)
	}

	// 从 logstore 读取最新的 日志对象（logstore 和 stablestore 存储的格式都是 msgpack 协议编码的）
	var lastLog Log
	if lastIndex > 0 {
		if err = logs.GetLog(lastIndex, &lastLog); err != nil {
			return nil, fmt.Errorf("failed to get last log at index %d: %v", lastIndex, err)
		}
	}

  // ...跳过一些不重要的代码

	// Create Raft struct.
	r := &Raft{
		// ...跳过一些不重要的代码
	}

	// 节点启动时默认为 Follower 角色
	r.setState(Follower)

	// ...跳过一些不重要的代码
	
	// Restore the current term and the last log.
	r.setCurrentTerm(currentTerm)
	// 这里在第一次启动节点的时候，因为执行过BootstrapCluster 方法做过初始化，所以至少会是 1
	r.setLastLog(lastLog.Index, lastLog.Term)

	// 尝试从 snapshot 中恢复操作
	if err := r.restoreSnapshot(); err != nil {
		return nil, err
	}

	// 获取在restoreSnapshot 方法中读取到的lastSnapshotIndex和lastSnapshotTerm
	snapshotIndex, _ := r.getLastSnapshot()
	
	// 如果最新的snapshot 与 logstore 中存的记录不一致，就逐个重新更新configurations 对象
	for index := snapshotIndex + 1; index <= lastLog.Index; index++ {
		var entry Log
		if err := r.logs.GetLog(index, &entry); err != nil {
			r.logger.Error(fmt.Sprintf("Failed to get log at %d: %v", index, err))
			panic(err)
		}
		r.processConfigurationLogEntry(&entry)
	}
	
	// 设置节点之间心跳通信的 rpc 处理函数
	trans.SetHeartbeatHandler(r.processHeartbeat)

	// 启动 goroutine
	r.goFunc(r.run)
	r.goFunc(r.runFSM)
	r.goFunc(r.runSnapshots)
	return r, nil
}
```

以上就是创建一个 Raft 主要的逻辑，那么节点启动后是怎么从`Follower`角色选出`Leader`的呢？继续往下看`r.run`启动的goroutine


```go
func (r *Raft) run() {
	for {
		// Check if we are doing a shutdown
		select {
		case <-r.shutdownCh:
			// Clear the leader to prevent forwarding
			r.setLeader("")
			return
		default:
		}

		// Enter into a sub-FSM
		switch r.getState() {
		case Follower:
			r.runFollower()
		case Candidate:
			r.runCandidate()
		case Leader:
			r.runLeader()
		}
	}
}
```

可以看到不同的角色会执行不同的逻辑，可是还是不知道角色之间怎么变化的，那继续往下看，因为默认是`Follower`，那就看下`r.runFollower`

```go
func (r *Raft) runFollower() {
    // ...跳过一些不重要的代码
    
    // 生成一个随机时间定时器
	heartbeatTimer := randomTimeout(r.conf.HeartbeatTimeout)

	for r.getState() == Follower {
		select {
		case rpc := <-r.rpcCh:
			r.processRPC(rpc)

		case c := <-r.configurationChangeCh:
			// Reject any operations since we are not the leader
			c.respond(ErrNotLeader)

		case a := <-r.applyCh:
			// Reject any operations since we are not the leader
			a.respond(ErrNotLeader)

		case v := <-r.verifyCh:
			// Reject any operations since we are not the leader
			v.respond(ErrNotLeader)

		case r := <-r.userRestoreCh:
			// Reject any restores since we are not the leader
			r.respond(ErrNotLeader)

		case r := <-r.leadershipTransferCh:
			// Reject any operations since we are not the leader
			r.respond(ErrNotLeader)

		case c := <-r.configurationsCh:
			c.configurations = r.configurations.Clone()
			c.respond(nil)

		case b := <-r.bootstrapCh:
			b.respond(r.liveBootstrap(b.configuration))

		case <-heartbeatTimer:
			// 重新生成一个随机时间定时器，准备下次触发
			heartbeatTimer = randomTimeout(r.conf.HeartbeatTimeout)

			// 判断是否已经和 Leader 联系上了
			lastContact := r.LastContact()
			if time.Now().Sub(lastContact) < r.conf.HeartbeatTimeout {
				continue
			}

			// Heartbeat failed! Transition to the candidate state
			lastLeader := r.Leader()
			r.setLeader("")

			if r.configurations.latestIndex == 0 {
			// 因为至少会有 1，所以不会走这里
				if !didWarn {
					r.logger.Warn("no known peers, aborting election")
					didWarn = true
				}
			} else if r.configurations.latestIndex == r.configurations.committedIndex &&
				!hasVote(r.configurations.latest, r.localID) {
				// 因为至少会有一个 voter 节点，所以不会走这里
				if !didWarn {
					r.logger.Warn("not part of stable configuration, aborting election")
					didWarn = true
				}
			} else {
			// 最终节点升级为Candidate
				r.logger.Warn(fmt.Sprintf("Heartbeat timeout from %q reached, starting election", lastLeader))
				metrics.IncrCounter([]string{"raft", "transition", "heartbeat_timeout"}, 1)
				r.setState(Candidate)
				return
			}

		case <-r.shutdownCh:
			return
		}
	}
}
```

至此节点升级为Candidate，我们再看下`r.runCandidate()`，这个阶段主要是投票选取 leader 节点

```go
func (r *Raft) runCandidate() {
	// ...
	// 开始请求投票（核心逻辑）
	voteCh := r.electSelf()

	// Make sure the leadership transfer flag is reset after each run. Having this
	// flag will set the field LeadershipTransfer in a RequestVoteRequst to true,
	// which will make other servers vote even though they have a leader already.
	// It is important to reset that flag, because this priviledge could be abused
	// otherwise.
	defer func() { r.candidateFromLeadershipTransfer = false }()

   // 设置选举超时时间，超时会退出当前方法，重启一轮
	electionTimer := randomTimeout(r.conf.ElectionTimeout)

	// Tally the votes, need a simple majority
	grantedVotes := 0
	// 计算需要多少投票节点通过（一半以上）
	votesNeeded := r.quorumSize()

	for r.getState() == Candidate {
		select {
		case rpc := <-r.rpcCh:
			r.processRPC(rpc)

		case vote := <-voteCh:
			// 检查其它节点的 term 数，如果比当前大，说明当前节点延迟同步了，需要继续 follow
			if vote.Term > r.getCurrentTerm() {
				r.logger.Debug("Newer term discovered, fallback to follower")
				r.setState(Follower)
				r.setCurrentTerm(vote.Term)
				return
			}

			// 判断其它节点是否投票给当前节点，有就累加票数
			if vote.Granted {
				grantedVotes++
				r.logger.Debug(fmt.Sprintf("Vote granted from %s in term %v. Tally: %d",
					vote.voterID, vote.Term, grantedVotes))
			}

			// 如果票数足够条件，就转为 leader 节点
			if grantedVotes >= votesNeeded {
				r.logger.Info(fmt.Sprintf("Election won. Tally: %d", grantedVotes))
				r.setState(Leader)
				r.setLeader(r.localAddr)
				return
			}

		// 略过...
		case <-electionTimer:
			// Election failed! Restart the election. We simply return,
			// which will kick us back into runCandidate
			r.logger.Warn("Election timeout reached, restarting election")
			return

		case <-r.shutdownCh:
			return
		}
	}
}
```

以上是`Candidate`角色下的主要逻辑，但是有个疑问，是否会有多个节点都满足票数的情况，这样集群中是否会出现多个 leader？

### processHeartbeat


```go

func (r *Raft) processHeartbeat(rpc RPC) {
	defer metrics.MeasureSince([]string{"raft", "rpc", "processHeartbeat"}, time.Now())

	// Check if we are shutdown, just ignore the RPC
	select {
	case <-r.shutdownCh:
		return
	default:
	}

	// Ensure we are only handling a heartbeat
	switch cmd := rpc.Command.(type) {
	case *AppendEntriesRequest:
		r.appendEntries(rpc, cmd)
	default:
		r.logger.Error(fmt.Sprintf("Expected heartbeat, got command: %#v", rpc.Command))
		rpc.Respond(nil, fmt.Errorf("unexpected command"))
	}
}
```