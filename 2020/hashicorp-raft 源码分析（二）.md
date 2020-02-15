# hashicorp/raft 源码分析（二）


## 结构定义

### Config

节点启动时的配置

```go
// Config provides any necessary configuration for the Raft server.
type Config struct {
	// ProtocolVersion allows a Raft server to inter-operate with older
	// Raft servers running an older version of the code. This is used to
	// version the wire protocol as well as Raft-specific log entries that
	// the server uses when _speaking_ to other servers. There is currently
	// no auto-negotiation of versions so all servers must be manually
	// configured with compatible versions. See ProtocolVersionMin and
	// ProtocolVersionMax for the versions of the protocol that this server
	// can _understand_.
	ProtocolVersion ProtocolVersion

	// 在还没有选举出 Leader 之前，在follower 角色时的触发心跳的间隔时间，默认是 1s+随机值
	HeartbeatTimeout time.Duration

	//  在还没有选举出 Leader 之前，在candidate 角色时的触发选举的间隔时间，默认是 1s+随机值
	ElectionTimeout time.Duration

	// CommitTimeout controls the time without an Apply() operation
	// before we heartbeat to ensure a timely commit. Due to random
	// staggering, may be delayed as much as 2x this value.
	CommitTimeout time.Duration

	// MaxAppendEntries controls the maximum number of append entries
	// to send at once. We want to strike a balance between efficiency
	// and avoiding waste if the follower is going to reject because of
	// an inconsistent log.
	MaxAppendEntries int

	// If we are a member of a cluster, and RemovePeer is invoked for the
	// local node, then we forget all peers and transition into the follower state.
	// If ShutdownOnRemove is is set, we additional shutdown Raft. Otherwise,
	// we can become a leader of a cluster containing only this node.
	ShutdownOnRemove bool

	// TrailingLogs controls how many logs we leave after a snapshot. This is
	// used so that we can quickly replay logs on a follower instead of being
	// forced to send an entire snapshot.
	TrailingLogs uint64

	// SnapshotInterval controls how often we check if we should perform a snapshot.
	// We randomly stagger between this value and 2x this value to avoid the entire
	// cluster from performing a snapshot at once.
	SnapshotInterval time.Duration

	// SnapshotThreshold controls how many outstanding logs there must be before
	// we perform a snapshot. This is to prevent excessive snapshots when we can
	// just replay a small set of logs.
	SnapshotThreshold uint64

	// LeaderLeaseTimeout is used to control how long the "lease" lasts
	// for being the leader without being able to contact a quorum
	// of nodes. If we reach this interval without contact, we will
	// step down as leader.
	LeaderLeaseTimeout time.Duration

	// 是否以 Leader 角色启动，只能在非生产环境使用。
	StartAsLeader bool

	// 集群中唯一的节点 ID
	LocalID ServerID

	// NotifyCh is used to provide a channel that will be notified of leadership
	// changes. Raft will block writing to this channel, so it should either be
	// buffered or aggressively consumed.
	NotifyCh chan<- bool

	LogOutput io.Writer
	LogLevel string
	Logger hclog.Logger

	// 配置节点启动的时候是否调用传入的 fsm 对象的 Restore 方法，默认是会调用的
	NoSnapshotRestoreOnStart bool
}
```

### Raft
解释下 Raft 结构每个字段的定义及作用

```go
// Raft implements a Raft node.
type Raft struct {
	raftState

	//节点协议的版本
	protocolVersion ProtocolVersion

	// applyCh is used to async send logs to the main thread to
	// be committed and applied to the FSM.
	applyCh chan *logFuture

	// Configuration provided at Raft initialization
	conf Config

	// FSM 
	fsm FSM

	// fsmMutateCh is used to send state-changing updates to the FSM. This
	// receives pointers to commitTuple structures when applying logs or
	// pointers to restoreFuture structures when restoring a snapshot. We
	// need control over the order of these operations when doing user
	// restores so that we finish applying any old log applies before we
	// take a user snapshot on the leader, otherwise we might restore the
	// snapshot and apply old logs to it that were in the pipe.
	fsmMutateCh chan interface{}

	// 用于触发一次 snapshot 的 channel，其中会调用 fsm 对象的 snapshot 方法
	fsmSnapshotCh chan *reqSnapshotFuture

	// lastContact 是最近一次和 Leader 节点联系的时间	lastContact     time.Time
	lastContactLock sync.RWMutex

	// 当前集群中 Leader 节点的地址
	leader     ServerAddress
	leaderLock sync.RWMutex

	// leaderCh is used to notify of leadership changes
	leaderCh chan bool

	// leaderState used only while state is leader
	leaderState leaderState

	// candidateFromLeadershipTransfer is used to indicate that this server became
	// candidate because the leader tries to transfer leadership. This flag is
	// used in RequestVoteRequest to express that a leadership transfer is going
	// on.
	candidateFromLeadershipTransfer bool

	// Stores our local server ID, used to avoid sending RPCs to ourself
	localID ServerID

	// Stores our local addr
	localAddr ServerAddress

	// Used for our logging
	logger hclog.Logger

	// LogStore provides durable storage for logs
	logs LogStore

	// Used to request the leader to make configuration changes.
	configurationChangeCh chan *configurationChangeFuture

	// 跟随 logstore 和 snapshot 的记录保存最新的元信息	configurations configurations

	// RPC chan comes from the transport layer
	rpcCh <-chan RPC

	// Shutdown channel to exit, protected to prevent concurrent exits
	shutdown     bool
	shutdownCh   chan struct{}
	shutdownLock sync.Mutex

	// snapshots is used to store and retrieve snapshots
	snapshots SnapshotStore

	// userSnapshotCh is used for user-triggered snapshots
	userSnapshotCh chan *userSnapshotFuture

	// userRestoreCh is used for user-triggered restores of external
	// snapshots
	userRestoreCh chan *userRestoreFuture

	// stable is a StableStore implementation for durable state
	// It provides stable storage for many fields in raftState
	stable StableStore

	// The transport layer we use
	trans Transport

	// verifyCh is used to async send verify futures to the main thread
	// to verify we are still the leader
	verifyCh chan *verifyFuture

	// configurationsCh is used to get the configuration data safely from
	// outside of the main thread.
	configurationsCh chan *configurationsFuture

	// bootstrapCh is used to attempt an initial bootstrap from outside of
	// the main thread.
	bootstrapCh chan *bootstrapFuture

	// List of observers and the mutex that protects them. The observers list
	// is indexed by an artificial ID which is used for deregistration.
	observersLock sync.RWMutex
	observers     map[uint64]*Observer

	// leadershipTransferCh is used to start a leadership transfer from outside of
	// the main thread.
	leadershipTransferCh chan *leadershipTransferFuture
}
```


### SnapshotMeta

```go
// SnapshotMeta is for metadata of a snapshot.
type SnapshotMeta struct {
	Version SnapshotVersion

	// ****snapshot 的 id，与建立的 snapshot 的目录名是一致的
	ID string

	// Index and Term store when the snapshot was taken.
	Index uint64
	Term  uint64

	// Peers is deprecated and used to support version 0 snapshots, but will
	// be populated in version 1 snapshots as well to help with upgrades.
	Peers []byte

	// Configuration and ConfigurationIndex are present in version 1
	// snapshots and later.
	Configuration      Configuration
	ConfigurationIndex uint64

	// Size is the size of the snapshot in bytes.
	Size int64
}
```