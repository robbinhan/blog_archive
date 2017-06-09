# Mybatis内存溢出

线上服务有个接口是接收后台任务统计的数据后通过Mybatis写入mysql，之前都没什么异常，今天突然收到几次报警，看了log就发现很多的`java.lang.OutOfMemoryError: Java heap space`而第一次出现的位置就是这个接口写入的地方。

于是下载了hprof文件，用VisualVM进行了分析（话说这玩意儿确实好用）发现是在调用Mybatis时，框架内做了Arrays.copyOf操作；网上搜了相关的文章，大多是说调整heap内存大小，确实我们线上只开了800M，但是也发现有人调整到了4G还是有溢出，看来指标不致本。不管怎么说先调大内存临时解决问题先吧。

后来想到他既然会copy一份，那我把传入的数据减少，同时操作完把我自己这份数据给手动清掉应该能节省内存，然后安排了当时接口的开发人员第二天优化接口，一切基本搞定。

第二天一来想看下线上服务在调大了内存后是不是基本正常了，发现凌晨的时候又报了溢出错误，难道还是太小了（修改后是1600M），于是我调到了2048M，但是想想不对，于是回过头来仔细看了下前一天报错的异常信息

```
at java.util.Arrays.copyOf(Arrays.java:3332)
at java.lang.AbstractStringBuilder.expandCapacity(AbstractStringBuilder.java:137)
at java.lang.AbstractStringBuilder.ensureCapacityInternal(AbstractStringBuilder.java:121)
at java.lang.AbstractStringBuilder.append(AbstractStringBuilder.java:421)
at java.lang.StringBuilder.append(StringBuilder.java:136)
at java.lang.StringBuilder.append(StringBuilder.java:131)
at java.util.AbstractCollection.toString(AbstractCollection.java:462)
at org.apache.ibatis.logging.jdbc.BaseJdbcLogger.getParameterValueString(BaseJdbcLogger.java:111)
at org.apache.ibatis.logging.jdbc.PreparedStatementLogger.invoke(PreparedStatementLogger.java:52)
```
看到最后是BaseJdbcLogger这个类的调用，看类名应该是记录logger的类，这个怎么会溢出呢？分析了源码（我们用的版本是3.3.1），`getParameterValueString`方法是获取执行sql的列的值拼接成字符串的方法，而这个过程中是调用`StringBuilder`的`append`方法将list的元素放入拼接（我们是传入了一个很大的list，有时可能会有几十万的对象元素），每次调用append方法，内部会判断当前数组空间是否还能放下插入的字符串的大小，如果长度不够时会调用`Arrays.copyOf`申请更大的内存分配，由于数据量较大，多次分配后整个内存不够用了。

既然是logger的问题，我就把线上的mybatis的logger给关了（其实之前一直是关的，那时没出过这个问题，不记得是什么原因给开了）；不过接口上的逻辑还是要调整。

总结下：
1. 线上logger千万要小心，不该记录的千万别记，尤其是大数据量的logger，或者通过level控制。
2. hprof文件是个好东西，配合VisualVM能发现问题到底在哪里
3. 一定要自己看异常的stack信息
