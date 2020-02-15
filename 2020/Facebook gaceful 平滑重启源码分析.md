# Facebook gaceful 平滑重启源码分析


- 发送信号给程序

```
kill -USR2 "${PROCESS_ID}"
```

- 程序监听到`SIGUSR2`进入重启逻辑

```go
func (a *app) signalHandler(wg *sync.WaitGroup) {
	ch := make(chan os.Signal, 10)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM, syscall.SIGUSR2)
	for {
		sig := <-ch
		switch sig {
		case syscall.SIGINT, syscall.SIGTERM:
			// 父进程处理现有请求并退出
			signal.Stop(ch)
			a.term(wg)
			return
		case syscall.SIGUSR2:
			err := a.preStartProcess()
			if err != nil {
				a.errors <- err
			}
			// 启动子进程
			if _, err := a.net.StartProcess(); err != nil {
				a.errors <- err
			}
		}
	}
}
```

- 为了不重新 bind 端口，copy 当前进程处理中的文件句柄，以备新的进程直接接管

 ```go
 func (n *Net) StartProcess() (int, error) {
	listeners, err := n.activeListeners()
	if err != nil {
		return 0, err
	}

	// Extract the fds from the listeners.
	files := make([]*os.File, len(listeners))
	for i, l := range listeners {
		files[i], err = l.(filer).File()
		if err != nil {
			return 0, err
		}
		defer files[i].Close()
	}

	// 重新找到新的可执行程序
	argv0, err := exec.LookPath(os.Args[0])
	if err != nil {
		return 0, err
	}

	// copy 环境变量
	var env []string
	for _, v := range os.Environ() {
		if !strings.HasPrefix(v, envCountKeyPrefix) {
			env = append(env, v)
		}
	}
	// 添加环境变量LISTEN_FDS，标识是子进程
	env = append(env, fmt.Sprintf("%s%d", envCountKeyPrefix, len(listeners)))

	allFiles := append([]*os.File{os.Stdin, os.Stdout, os.Stderr}, files...)
	// 启动新的进程，接管原来的文件句柄
	process, err := os.StartProcess(argv0, os.Args, &os.ProcAttr{
		Dir:   originalWD,
		Env:   env,
		Files: allFiles,
	})
	if err != nil {
		return 0, err
	}
	return process.Pid, nil
}
 ```
 
 以上是重启新进程的逻辑，但是这里启动了新进程，老的进程怎么平滑退出呢？
 
 
 我们再来看看启动时的 `run` 方法做了什么
 
 ```go
func (a *app) run() error {
    	// 开始监听端口
    	if err := a.listen(); err != nil {
    		return err
    	}
    
    	// ...略过一些不重要的代码
    	
    	// 调用 httpdown 的 Serve 方法，这里不会阻塞
    	a.serve()
    
    	// 这里判断如果是当前是子进程，就会发送SIGTERM 信号给父进程
    	if didInherit && ppid != 1 {
    		if err := syscall.Kill(ppid, syscall.SIGTERM); err != nil {
    			return fmt.Errorf("failed to close parent: %s", err)
    		}
    	}
    
    	waitdone := make(chan struct{})
    	go func() {
    		defer close(waitdone)
    		a.wait()
    	}()
}
 ```
 
 关键的地方就在调用了httpdown 包了
 
 ```go
func (h HTTP) Serve(s *http.Server, l net.Listener) Server {
    	// 省略不重要的代码...
    	
    	// 核心
    	go ss.manage()
    	// 封装启动方法
    	go ss.serve()
    	return ss
}
 ```
 
 
 可以看到核心的处理请求是在 manage 方法中做的(这里去除了一些不重要的代码)
 
 ```go
 func (s *server) manage() {
    	var stopDone chan struct{}
    
    	conns := map[net.Conn]http.ConnState{}
    	var countNew, countActive, countIdle float64
    
    
    	for {
    		select {
     		case c := <-s.idle:
    			decConn(c)
    			countIdle++
    
    			conns[c] = http.StateIdle
    
    			// 遇到stopDone 事件，直接关闭当前请求连接
    			if stopDone != nil {
    				c.Close()
    			}
    		case c := <-s.closed:
    			stats.BumpSum(s.stats, "conn.closed", 1)
    			decConn(c)
    			delete(conns, c)
    
    			// 遇到stopDone 事件，并且当所有的连接都关闭了，就返回
    			if stopDone != nil && len(conns) == 0 {
    				close(stopDone)
    				return
    			}
    		case stopDone = <-s.stop:
    			// 当所有的连接都处理完了，就返回
    			if len(conns) == 0 {
    				close(stopDone)
    				return
    			}
    
    			// 关闭剩余空闲连接
    			for c, cs := range conns {
    				if cs == http.StateIdle {
    					c.Close()
    				}
    			}
    		case killDone := <-s.kill:
    			// 强制关闭所有连接
    			stats.BumpSum(s.stats, "kill.conn.count", float64(len(conns)))
    			for c := range conns {
    				c.Close()
    			}
    
    			close(killDone)
    		}
    	}
}
```


```go
// 父进程收到SIGTERM 信号会调用 Stop 方法
func (s *server) Stop() error {
    	s.stopOnce.Do(func() {
    		defer stats.BumpTime(s.stats, "stop.time").End()
    		stats.BumpSum(s.stats, "stop", 1)
    
    		// first disable keep-alive for new connections
    		s.server.SetKeepAlivesEnabled(false)
    
    		// 父进程不再接收请求
    		closeErr := s.listener.Close()
    		<-s.serveDone
    		
    		stopDone := make(chan struct{})
    		s.stop <- stopDone
    
    		// wait for stop
    		select {
    		case <-stopDone:
    		case <-s.clock.After(s.stopTimeout):
    			defer stats.BumpTime(s.stats, "kill.time").End()
    			stats.BumpSum(s.stats, "kill", 1)
    
    			// 超时或连接已经全部关闭，触发 kill
    			killDone := make(chan struct{})
    			s.kill <- killDone
    			select {
    			case <-killDone:
    			case <-s.clock.After(s.killTimeout):
    				// kill 超时不再做处理（可能是连接数太多，无法在超时范围内关闭）
    				stats.BumpSum(s.stats, "kill.timeout", 1)
    			}
    		}
    
    		if closeErr != nil && !isUseOfClosedError(closeErr) {
    			stats.BumpSum(s.stats, "listener.close.error", 1)
    			s.stopErr = closeErr
    		}
    	})
    	return s.stopErr
}
```

## 总结
到此平滑重启的逻辑就分析完毕了，但是为什么父进程关闭了，子进程还在呢？关键在于发送给父进程的信号是`SIGTERM`，这个信号只对当前进程有效，当前进程被kill，他的子进程的父进程 pid 就变成 1 了。


## 参考文献
- [Nginx vs Envoy vs Mosn 平滑升级原理解析](https://ms2008.github.io/2019/12/28/hot-upgrade/)
- [linux中的信号 SIGINT SIGTERM SIGKILL](https://blog.csdn.net/fanren224/article/details/79693905)







 
 
 
