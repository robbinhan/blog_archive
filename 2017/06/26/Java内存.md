# Java内存（一）

## JVM简介

JVM的体系结构包含几个主要的子系统和内存区：
- 垃圾回收器
- 类装载子系统
- 执行引擎
- 运行时数据区


运行时数据区就是常说的java内存

![jvm](http://incdn1.b0.upaiyun.com/2015/04/b5ae824fd22dbdd967961fb6caa52c17.jpg)

## java内存分区

- 程序计数器
- 栈
- 本地方法栈
- 方法区(JDK8以后改成Metaspace)
- 堆
