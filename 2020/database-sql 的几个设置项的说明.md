# database/sql 的几个设置项的说明

## MaxOpenConns
含义：最大能打开的连接数
描述：连接池最多可以开启的连接数，不会开启超过这个值的连接，如果设置 <= 0 的值，才会不限制数量 

## MaxIdleConns
含义：最大空闲连接数
描述：连接池最多可以长期维护的连接数，比方设置了 100，MaxOpenConns 设置 1000，并发请求 500，就会开启了 500 个连接，处理完后会维持 100 个连接在池中。

## ConnMaxLifetime
含义：连接的最大生命周期
描述：当`IdleConns`中的连接维护时间超过`ConnMaxLifetime`的值，这个连接就会关闭